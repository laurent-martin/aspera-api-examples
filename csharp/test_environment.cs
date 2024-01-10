using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;
using IObjectHash = System.Collections.Generic.IDictionary<string, object>;
using StringDict = System.Collections.Generic.Dictionary<string, string>;
class Log
{
    public static readonly log4net.ILog log = log4net.LogManager.GetLogger(typeof(Log));
    public static void DebugStruct(IObjectHash value)
    {
        log.Debug(Newtonsoft.Json.JsonConvert.SerializeObject(value, Newtonsoft.Json.Formatting.Indented));
    }
}


public class TestEnvironment
{
    public static StringDict readConfig()
    {
        StringDict aoc_config;
        using (var reader = new StreamReader("../private/config.yaml"))
        {
            var deserializer = new DeserializerBuilder()
                .WithNamingConvention(CamelCaseNamingConvention.Instance)
                .Build();
            var doc = deserializer.Deserialize<Dictionary<string, StringDict>>(reader);
            aoc_config = doc["aoc"];
        }
        // init logger
        log4net.Config.BasicConfigurator.Configure();
        return aoc_config;
    }
}