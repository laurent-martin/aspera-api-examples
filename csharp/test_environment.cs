class Log
{
    public static readonly log4net.ILog log = log4net.LogManager.GetLogger(typeof(Log));
    public static void DebugStruct(IDictionary<string, object> value)
    {
        log.Debug(Newtonsoft.Json.JsonConvert.SerializeObject(value, Newtonsoft.Json.Formatting.Indented));
    }
}

public class TestEnvironment
{
    public static Dictionary<string, Dictionary<string, string>> readConfig()
    {
        // init logger
        log4net.Config.BasicConfigurator.Configure();
        using (var reader = new StreamReader("../private/config.yaml"))
        {
            var deserializer = new YamlDotNet.Serialization.DeserializerBuilder()
                .WithNamingConvention(YamlDotNet.Serialization.NamingConventions.CamelCaseNamingConvention.Instance)
                .Build();
            return deserializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(reader);
        }
    }
}
