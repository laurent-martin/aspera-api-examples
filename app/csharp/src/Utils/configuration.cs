using Newtonsoft.Json.Linq;
using System.Text.RegularExpressions;

/// <summary>
/// Logger of the samples, with hiding of secrets.
/// </summary>
class Log
{
    public static readonly log4net.ILog log = log4net.LogManager.GetLogger(typeof(Log));
    // secrets in logs: value of JSON keys ending with one of those words, and JWT assertion in form parameters
    private static readonly Regex SECRETS_REGEX = new Regex(@"(""[^""]*(?:assertion|authorization|password|private_key|secret|token)""\s*:\s*"")[^""]+|(assertion=)[^&]+");
    // set from configuration file (misc.show_secrets)
    public static bool ShowSecrets = false;
    /// <summary>
    /// Hide secrets in text for logs, unless configured to show them.
    /// </summary>
    /// <param name="text">text that may contain secrets</param>
    /// <returns>text with hidden secrets</returns>
    public static string MaskSecrets(string text)
    {
        return ShowSecrets ? text : SECRETS_REGEX.Replace(text, "$1$2***");
    }
    /// <summary>
    /// Log a named value: objects are displayed in JSON, and secrets are hidden.
    /// </summary>
    /// <param name="name">name of the value</param>
    /// <param name="value">value to log: a string, or an object displayed in JSON</param>
    /// <param name="level">log level, debug by default</param>
    public static void Dump(string name, object value, log4net.Core.Level? level = null)
    {
        var logLevel = level ?? log4net.Core.Level.Debug;
        if (!log.Logger.IsEnabledFor(logLevel))
        {
            return;
        }
        var text = value as string ?? Newtonsoft.Json.JsonConvert.SerializeObject(value);
        log.Logger.Log(typeof(Log), logLevel, $"{name}: {MaskSecrets(text)}", null);
    }
    /// <summary>
    /// Set up logging to the console.
    /// </summary>
    /// <param name="levelName"><c>debug</c>, <c>info</c>, <c>warning</c> or <c>error</c></param>
    public static void Setup(string levelName)
    {
        var level = levelName switch
        {
            "debug" => log4net.Core.Level.Debug,
            "info" => log4net.Core.Level.Info,
            "warning" => log4net.Core.Level.Warn,
            "error" => log4net.Core.Level.Error,
            _ => throw new Exception($"Invalid log level: {levelName}"),
        };
        var layout = new log4net.Layout.PatternLayout("%-8level %message%newline");
        layout.ActivateOptions();
        var appender = new log4net.Appender.ConsoleAppender { Layout = layout, Threshold = level };
        appender.ActivateOptions();
        log4net.Config.BasicConfigurator.Configure(appender);
    }
}
/// <summary>
/// Configuration of the samples: parameters from the configuration file, files to transfer from the command line, and logging.
/// </summary>
public class Configuration
{
    /// <summary>
    /// Read the configuration file, and set up logging.
    /// </summary>
    /// <param name="args">command line arguments: files to transfer</param>
    public Configuration(string[] args)
    {
        _fileList = args;
        // get project root folder
        string? topFolder = Environment.GetEnvironmentVariable("DIR_TOP");
        if (string.IsNullOrEmpty(topFolder))
        {
            throw new Exception("Environment variable DIR_TOP is not set");
        }
        mTopFolder = topFolder;
        if (!Directory.Exists(mTopFolder))
        {
            throw new Exception($"Folder not found: {mTopFolder}");
        }

        // read project's relative paths config file
        using (var reader = new StreamReader(Path.Combine(mTopFolder, PATHS_FILE_REL)))
        {
            mPaths = new YamlDotNet.Serialization.DeserializerBuilder()
                .WithNamingConvention(YamlDotNet.Serialization.NamingConventions.CamelCaseNamingConvention.Instance)
                .Build().Deserialize<Dictionary<string, string>>(reader);
        }
        // Read configuration from configuration file
        using (var reader = new StreamReader(GetPath("main_config")))
        {
            _config = new YamlDotNet.Serialization.DeserializerBuilder()
                .WithNamingConvention(YamlDotNet.Serialization.NamingConventions.CamelCaseNamingConvention.Instance)
                .Build().Deserialize<Dictionary<string, Dictionary<string, string>>>(reader);
        }
        Log.Setup(GetParam("misc", "level"));
        Log.ShowSecrets = GetParam("misc", "show_secrets", "false") == "true";
    }
    /// <summary>
    /// Get the folder for log files.
    /// </summary>
    /// <returns>folder for log files</returns>
    public string LogFolder()
    {
        return Path.GetTempPath();
    }


    /// <summary>
    /// Get the path of an item of the project, from the paths file.
    /// </summary>
    /// <param name="name">name of the item in the paths file</param>
    /// <returns>absolute path of the item, that must exist</returns>
    public string GetPath(string name)
    {
        // Get configuration sub-path in project's root folder
        var itemPath = Path.Combine(mTopFolder, mPaths[name]);
        if (!File.Exists(itemPath))
        {
            throw new Exception($"File not found: {itemPath}");
        }
        return itemPath;
    }
    /// <summary>
    /// Get a parameter from the configuration file.
    /// </summary>
    /// <param name="section">section in the configuration file</param>
    /// <param name="key">name of the parameter in the section</param>
    /// <param name="defaultValue">value if the parameter is not set, else the parameter is mandatory</param>
    /// <returns>value of the parameter</returns>
    public string GetParam(string section, string key, string? defaultValue = null)
    {
        if (!_config.ContainsKey(section) || !_config[section].ContainsKey(key))
        {
            if (defaultValue != null)
            {
                return defaultValue;
            }
            throw new Exception($"Configuration parameter not found: {section}.{key}");
        }
        return _config[section][key];
    }
    /// <summary>
    /// Add the files to transfer, from the command line arguments, to the transfer spec.
    /// </summary>
    /// <param name="aSpecObj">transfer spec to modify</param>
    /// <param name="where">name of the file list in the transfer spec: <c>paths</c></param>
    public void AddSources(JObject aSpecObj, string where)
    {
        // add file list in transfer spec
        var paths = aSpecObj[where] as JArray ?? throw new Exception($"Invalid path in transfer spec: {where}");
        foreach (string f in _fileList)
        {
            paths.Add(new JObject { { "source", f } });
        }
    }

    private string[] _fileList;
    // general test configuration parameters
    private Dictionary<string, Dictionary<string, string>> _config;
    // general path structure
    private Dictionary<string, string> mPaths;
    private string mTopFolder;
    // config file with sub-paths in project's root folder
    private const string PATHS_FILE_REL = "config/paths.yaml";
}
