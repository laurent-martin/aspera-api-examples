// Generic REST client with basic and oauth
// Replace with your best REST client object

using System.Security.Cryptography;
using ObjectDict = System.Collections.Generic.Dictionary<string, object>;
using IObjectHash = System.Collections.Generic.IDictionary<string, object>;
using StringDict = System.Collections.Generic.Dictionary<string, string>;
using System.Net.Http;
using System.Net.Http.Headers;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json;

public class Rest
{
    public StringDict mApiData;
    private HttpClient mHttpClient;


    private static RSA readKeyFromFile(string filename)
    {
        string pemContents = System.IO.File.ReadAllText(filename);
        const string RsaPrivateKeyHeader = "-----BEGIN RSA PRIVATE KEY-----";
        const string RsaPrivateKeyFooter = "-----END RSA PRIVATE KEY-----";

        if (!pemContents.StartsWith(RsaPrivateKeyHeader))
        {
            throw new InvalidOperationException();
        }
        int endIdx = pemContents.IndexOf(
            RsaPrivateKeyFooter,
            RsaPrivateKeyHeader.Length,
            StringComparison.Ordinal);

        string base64 = pemContents.Substring(
            RsaPrivateKeyHeader.Length,
            endIdx - RsaPrivateKeyHeader.Length);

        byte[] der = Convert.FromBase64String(base64);
        RSA rsa = RSA.Create();
        rsa.ImportRSAPrivateKey(der, out _);
        return rsa;
    }

    static string DumpHttpRequestMessage(HttpRequestMessage request)
    {
        // Convert HttpRequestMessage to a string representation
        string requestDump = $"{request.Method} {request.RequestUri}\n";

        // Dump headers
        foreach (var header in request.Headers)
        {
            requestDump += $"{header.Key}: {string.Join(", ", header.Value)}\n";
        }
        if (request.Content != null)
        {
            foreach (var header in request.Content.Headers)
            {
                requestDump += $"{header.Key}: {string.Join(", ", header.Value)}\n";
            }
        }

        // Dump content
        if (request.Content != null)
        {
            requestDump += $"\n{request.Content.ReadAsStringAsync().Result}\n";
        }

        return requestDump;
    }
    public Rest(StringDict api_data)
    {
        // shallow copy sufficient here
        mApiData = api_data.ToDictionary(entry => entry.Key, entry => entry.Value);

        mHttpClient = new HttpClient
        {
            BaseAddress = new Uri(mApiData["base_url"])
        };
    }
    public IObjectHash call(ObjectDict call_data)
    {
        string uri_string = mApiData["base_url"] + "/" + call_data["subpath"];
        var builder = new System.UriBuilder(uri_string);// { Query = collection.ToString() };
        if (call_data.ContainsKey("url_params") && call_data["url_params"] != null)
        {
            ObjectDict query = (ObjectDict)call_data["url_params"];
            //throw new System.Exception("TODO");
            string query_string = "";
            foreach (var key in query.Keys)
            {
                if (query_string.Length != 0)
                {
                    query_string = query_string + "&";
                }
                query_string = query_string + System.Uri.EscapeDataString(key) + "=" + System.Uri.EscapeDataString("" + query[key]);
            }
            builder.Query = query_string;
        }
        HttpRequestMessage request = new HttpRequestMessage
        {
            Method = (HttpMethod)call_data["operation"],
            RequestUri = builder.Uri
        };
        switch (mApiData["type"])
        {
            case "oauth2":
                long seconds_since_epoch = System.DateTimeOffset.Now.ToUnixTimeSeconds();
                var payload = new ObjectDict()
                {
                           { "iss", mApiData["oauth_client_id"]},
                           { "sub", mApiData["oauth_jwt_subject"]},
                           { "aud", mApiData["oauth_jwt_audience"]},
                           { "nbf", seconds_since_epoch - 60},
                           { "exp", seconds_since_epoch + 300},
                };
                // if client id starts with "aspera", add key "org" to payload
                if (mApiData["oauth_client_id"].StartsWith("aspera."))
                {
                    payload["org"] = mApiData["aoc_org"];
                }
                var private_key = readKeyFromFile(mApiData["oauth_file_private_key"]);
                string assertion = Jose.JWT.Encode(payload, private_key, Jose.JwsAlgorithm.RS256);
                Rest token_api = new Rest(new StringDict(){
                               {"base_url",mApiData["oauth_base_url"]},
                               {"type","basic"},
                               {"basic_username",mApiData["oauth_client_id"]},
                               {"basic_password",mApiData["oauth_client_secret"]},
                });
                var resp = token_api.create(mApiData["oauth_path_token"], new ObjectDict(){
                           {"www_body_params",true},
                           {"grant_type","urn:ietf:params:oauth:grant-type:jwt-bearer"},
                           {"assertion",assertion},
                           {"scope",mApiData["oauth_scope"]},
                });
                var data = (Newtonsoft.Json.Linq.JObject)resp["data"];
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", (string)data["access_token"]);
                break;
            case "basic":
                var encoded = Convert.ToBase64String(System.Text.ASCIIEncoding.ASCII.GetBytes($"{mApiData["basic_username"]}:{mApiData["basic_password"]}"));
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", encoded);
                break;
            default:
                throw new System.Exception("error");
        }
        if (call_data.ContainsKey("json_params"))
        {
            var json_params = (ObjectDict)call_data["json_params"];
            Log.log.Debug("json_params");
            Log.DebugStruct(json_params);
            if (json_params.ContainsKey("www_body_params"))
            {
                json_params.Remove("www_body_params");
                request.Content = new FormUrlEncodedContent(json_params.ToDictionary(kvp => kvp.Key, kvp => kvp.Value.ToString()));
            }
            else
            {
                request.Content = new StringContent(
                    JsonConvert.SerializeObject(call_data["json_params"]),
                    System.Text.Encoding.UTF8,
                    "application/json");
            }
        }
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        //Log.log.Debug("req=" + JsonConvert.SerializeObject(request, Newtonsoft.Json.Formatting.Indented));
        Log.log.Debug("req=" + DumpHttpRequestMessage(request));
        var response = mHttpClient.SendAsync(request).Result;
        response.EnsureSuccessStatusCode();
        var resp_str = response.Content.ReadAsStringAsync().Result;
        Log.log.Debug("resp=" + resp_str);
        Newtonsoft.Json.Linq.JContainer stuff = null;
        if (resp_str.Length != 0)
        {
            if (resp_str.StartsWith("["))
            {
                stuff = Newtonsoft.Json.Linq.JArray.Parse(resp_str);
            }
            else
            {
                stuff = Newtonsoft.Json.Linq.JObject.Parse(resp_str);
            }
        }
        return new ObjectDict() { { "data", stuff } };

        //StringDict res = Newtonsoft.Json.JsonConvert.DeserializeObject<StringDict>(resp_str);
        //Log.log.Debug(">new resp>>>>>>>>>>>>>>>>>"+Newtonsoft.Json.JsonConvert.SerializeObject(result,Newtonsoft.Json.Formatting.Indented));
        //return result;
    }
    public IObjectHash create(string subpath, IObjectHash json_params)
    {
        return call(new ObjectDict(){
        {"operation",HttpMethod.Post},{"subpath",subpath},{"headers",new ObjectDict(){{"Accept","application/json"}}},{"json_params",json_params}});
    }
    public IObjectHash read(string subpath, IObjectHash url_params = null)
    {
        return call(new ObjectDict(){
        {"operation",HttpMethod.Get},{"subpath",subpath},{"headers",new ObjectDict(){{"Accept","application/json"}}},{"url_params",url_params}});
    }
    public IObjectHash update(string subpath, IObjectHash json_params)
    {
        return call(new ObjectDict(){
        {"operation",HttpMethod.Put},{"subpath",subpath},{"headers",new ObjectDict(){{"Accept","application/json"}}},{"json_params",json_params}});
    }
    public IObjectHash delete(string subpath)
    {
        return call(new ObjectDict(){
        {"operation",HttpMethod.Delete},{"subpath",subpath},{"headers",new ObjectDict(){{"Accept","application/json"}}}});
    }
}