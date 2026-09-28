using Newtonsoft.Json.Linq;

class Log
{
    public static readonly log4net.ILog log = log4net.LogManager.GetLogger(typeof(Log));
    public static void DumpJObject(string name, Object value)
    {
        log.Debug($"{name}={Newtonsoft.Json.JsonConvert.SerializeObject(value, Newtonsoft.Json.Formatting.Indented)}");
    }
}
public class Configuration
{
    public Configuration(string[] args)
    {
        _fileList = args;
        // init logger
        log4net.Config.BasicConfigurator.Configure();
        // get project root folder
        mTopFolder = Environment.GetEnvironmentVariable("DIR_TOP");
        if (string.IsNullOrEmpty(mTopFolder))
        {
            throw new InvalidOperationException("Environment variable DIR_TOP is not set.");
        }
        if (!Directory.Exists(mTopFolder))
        {
            throw new DirectoryNotFoundException($"The folder specified by DIR_TOP does not exist: {mTopFolder}");
        }

        // read project's relative paths config file
        using (var reader = new StreamReader(Path.Combine(mTopFolder, PATHS_FILE_REL)))
        {
            mPaths = new YamlDotNet.Serialization.DeserializerBuilder()
                .WithNamingConvention(YamlDotNet.Serialization.NamingConventions.CamelCaseNamingConvention.Instance)
                .Build().Deserialize<Dictionary<string, string>>(reader);
        }
        // Read configuration from configuration file
        using (var reader = new StreamReader(Path.Combine(mTopFolder, mPaths["main_config"])))
        {
            _config = new YamlDotNet.Serialization.DeserializerBuilder()
                .WithNamingConvention(YamlDotNet.Serialization.NamingConventions.CamelCaseNamingConvention.Instance)
                .Build().Deserialize<Dictionary<string, Dictionary<string, string>>>(reader);
        }
    }
    public string LogFolder()
    {
        return Path.GetTempPath();
    }


    /// <summary>
    /// Get absolute path for the named folder from configuration file
    /// </summary>
    /// <param name="name">name of configuration</param>
    /// <returns>absolute path for the named folder from configuration file</returns>
    /// <exception cref="Exception">if file does not exists</exception>
    public string GetPath(string name)
    {
        // Get configuration sub-path in project's root folder
        var itemPath = Path.Combine(mTopFolder, mPaths[name]);
        if (!File.Exists(itemPath))
        {
            throw new Exception($"ERROR: {itemPath} not found.");
        }
        return itemPath;
    }
    public string GetParam(string section, string key)
    {
        if (!_config.ContainsKey(section) || !_config[section].ContainsKey(key))
        {
            throw new Exception($"ERROR: {section}.{key} not found in configuration file.");
        }
        return _config[section][key];
    }
    public void AddSources(JObject aSpecObj, string where)
    {
        // add file list in transfer spec
        foreach (string f in _fileList)
        {
            ((JArray)aSpecObj[where]).Add(new JObject { { "source", f } });
        }
    }
    /// <summary>
    /// Get the last non-empty line of a file (log files are small, so read it all)
    /// </summary>
    public static string LastFileLine(string filename)
    {
        // the file may still be written by the daemon
        using (var file = new FileStream(filename, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        using (var reader = new StreamReader(file))
        {
            string lastLine = null;
            string line;
            while ((line = reader.ReadLine()) != null)
            {
                if (line.Length != 0)
                    lastLine = line;
            }
            if (lastLine == null)
                throw new InvalidOperationException("File is empty");
            return lastLine;
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
