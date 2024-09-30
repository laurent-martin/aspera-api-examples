//using System.Net.Http;
using System.Net.Http.Headers;
// for RSA
using System.Security.Cryptography;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using StringDict = System.Collections.Generic.Dictionary<string, string>;

/// <summary>
/// Generic REST client with basic and oauth.
/// Replace with your best REST client object
/// or use openapi generator to generate stubs.
/// </summary>
public class Rest
{
    // take come time back to account for time offset between client and server
    private const int JWT_NOT_BEFORE_OFFSET_SEC = 60;
    // take some validity for the JWT
    private const int JWT_EXPIRY_OFFSET_SEC = 600;
    private StringDict mApiData;
    private Rest mOAuthAPI;
    private HttpClient mHttpClient;

    /// <summary>
    /// Read RSA private key from file.
    /// </summary>
    /// <param name="filename"></param>
    /// <returns>RSA key</returns>
    /// <exception cref="InvalidOperationException"></exception>
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
    public Rest(StringDict api_data)
    {
        // shallow copy sufficient here
        mApiData = api_data.ToDictionary(entry => entry.Key, entry => entry.Value);

        mHttpClient = new HttpClient
        {
            BaseAddress = new Uri(mApiData["base_url"])
        };
    }
    public string get_bearer_token(string scope)
    {
        long seconds_since_epoch = System.DateTimeOffset.Now.ToUnixTimeSeconds();
        var payload = new JObject{
                    { "iss", mApiData["oauth_client_id"]},
                    { "sub", mApiData["oauth_jwt_subject"]},
                    { "aud", mApiData["oauth_jwt_audience"]},
                    { "nbf", seconds_since_epoch - JWT_NOT_BEFORE_OFFSET_SEC},
                    { "iat", seconds_since_epoch - JWT_NOT_BEFORE_OFFSET_SEC},
                    { "exp", seconds_since_epoch + JWT_EXPIRY_OFFSET_SEC},
                };
        // if client id starts with "aspera", add key "org" to payload
        if (mApiData["oauth_client_id"].StartsWith("aspera."))
        {
            payload["org"] = mApiData["aoc_org"];
        }
        Log.DumpJObject("payload", payload);
        var private_key = readKeyFromFile(mApiData["oauth_file_private_key"]);
        string assertion = Jose.JWT.Encode(JsonConvert.SerializeObject(payload), private_key, Jose.JwsAlgorithm.RS256, extraHeaders: new Dictionary<string, object> { { "typ", "JWT" } });
        var token_params = new JObject{
            {"www_body_params",true},
            {"client_id",mApiData["oauth_client_id"]},
            {"grant_type","urn:ietf:params:oauth:grant-type:jwt-bearer"},
            {"assertion",assertion},
        };
        if (scope != null)
        {
            token_params["scope"] = scope;
        }
        JObject data = (JObject)mOAuthAPI.create(mApiData["oauth_path_token"], token_params);
        return (string)data["access_token"];
    }
    public string get_bearer(string scope)
    {
        return $"Bearer {get_bearer_token(scope)}";
    }
    /// <summary>
    /// Call REST API.
    /// </summary>
    /// <param name="operation">GET, ...</param>
    /// <param name="subpath">endpoint</param>
    /// <param name="json_params"></param>
    /// <param name="url_params"></param>
    /// <param name="headers"></param>
    /// <returns></returns>
    /// <exception cref="System.Exception"></exception>
    public JContainer call(HttpMethod operation, string subpath, JObject json_params = null, JObject url_params = null, StringDict headers = null)
    {
        string uri_string = mApiData["base_url"] + "/" + subpath;
        var builder = new System.UriBuilder(uri_string);// { Query = collection.ToString() };
        if (url_params != null)
        {
            var query = url_params.Properties().ToDictionary(p => p.Name, p => p.Value.ToString());
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
            Method = operation,
            RequestUri = builder.Uri
        };
        switch (mApiData["type"])
        {
            case "oauth2":
                mOAuthAPI = new Rest(new StringDict(){
                    {"base_url",mApiData["oauth_base_url"]},
                    {"type","basic"},
                    {"basic_username",mApiData["oauth_client_id"]},
                    {"basic_password",mApiData["oauth_client_secret"]},
                });
                string scope = null;
                if (mApiData.ContainsKey("oauth_scope"))
                {
                    scope = mApiData["oauth_scope"];
                }
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", get_bearer_token(scope));
                break;
            case "basic":
                var encoded = Convert.ToBase64String(System.Text.ASCIIEncoding.ASCII.GetBytes($"{mApiData["basic_username"]}:{mApiData["basic_password"]}"));
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", encoded);
                break;
            default:
                throw new System.Exception("wrong auth type");
        }
        if (json_params != null)
        {
            Log.log.Debug($"json_params {json_params}");
            if (json_params.ContainsKey("www_body_params"))
            {
                json_params.Remove("www_body_params");
                request.Content = new FormUrlEncodedContent(json_params.Properties().ToDictionary(p => p.Name, p => p.Value.ToString()));
            }
            else
            {
                request.Content = new StringContent(
                    JsonConvert.SerializeObject(json_params),
                    System.Text.Encoding.UTF8,
                    "application/json");
            }
        }
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        Log.DumpJObject("req", request);
        if (request.Content != null)
        {
            Log.log.Debug($"data={request.Content.ReadAsStringAsync().Result}");
        }
        var response = mHttpClient.SendAsync(request).Result;
        var resp_str = response.Content.ReadAsStringAsync().Result;
        Log.log.Debug($"resp={resp_str}");
        if (!response.IsSuccessStatusCode)
        {
            throw new System.Exception($"ERROR: {response.StatusCode} {response.ReasonPhrase}");
        }
        JContainer result = null;
        if (resp_str.Length != 0)
        {
            if (resp_str.StartsWith("["))
            {
                result = JArray.Parse(resp_str);
            }
            else
            {
                result = JObject.Parse(resp_str);
            }
        }
        return result;
    }
    public JContainer create(string subpath, JObject json_params)
    {
        return call(operation: HttpMethod.Post, subpath: subpath, headers: new StringDict { { "Accept", "application/json" } }, json_params: json_params);
    }
    public JContainer read(string subpath, JObject url_params = null)
    {
        return call(operation: HttpMethod.Get, subpath: subpath, headers: new StringDict { { "Accept", "application/json" } }, url_params: url_params);
    }
    public JContainer update(string subpath, JObject json_params)
    {
        return call(operation: HttpMethod.Put, subpath: subpath, headers: new StringDict { { "Accept", "application/json" } }, json_params: json_params);
    }
    public JContainer delete(string subpath)
    {
        return call(operation: HttpMethod.Delete, subpath: subpath, headers: new StringDict { { "Accept", "application/json" } });
    }
}