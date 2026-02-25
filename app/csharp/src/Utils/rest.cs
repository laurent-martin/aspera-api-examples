//using System.Net.Http;
using System.Net.Http.Headers;
// for RSA
using System.Security.Cryptography;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using StringDict = System.Collections.Generic.Dictionary<string, string>;

public static class Const
{
    // take come time back to account for time offset between client and server
    public const int JWT_CLIENT_SERVER_OFFSET_SEC = 60;
    // take some validity for the JWT
    public const int JWT_VALIDITY_SEC = 600;
    public const string MIME_JSON = "application/json";
    public const string MIME_WWW = "application/x-www-form-urlencoded";
    public const string IETF_GRANT_JWT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
}

/// <summary>
/// Generic REST client with basic and oauth.
/// Replace with your best REST client object
/// or use openapi generator to generate stubs.
/// </summary>
public class Rest
{
    public Rest(string url)
    {
        mBaseUrl = url;
        mHttpClient = new HttpClient
        {
            BaseAddress = new Uri(mBaseUrl)
        };
        mHeaders = new StringDict();
        mAuthData = null;
    }
    public void setAuthBasic(string username, string password)
    {
        mHeaders.Add("Authorization", "Basic " + Convert.ToBase64String(System.Text.Encoding.ASCII.GetBytes(username + ":" + password)));
        //var encoded = Convert.ToBase64String(System.Text.ASCIIEncoding.ASCII.GetBytes($"{mAuthData["basic_username"]}:{mAuthData["basic_password"]}"));
        //request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", encoded);
    }

    public void setAuthBearer(StringDict auth)
    {
        // shallow copy sufficient here
        mAuthData = auth.ToDictionary(entry => entry.Key, entry => entry.Value);
    }
    public void setDefaultScope(string scope)
    {
        mHeaders.Add("Authorization", get_bearer_token(scope));
    }
    public void setHeader(string name, string value)
    {
        mHeaders.Add(name, value);
    }
    public string get_bearer_token(string scope)
    {
        RSA private_key = readKeyFromFile(mAuthData["key_pem_path"]);
        long seconds_since_epoch = System.DateTimeOffset.Now.ToUnixTimeSeconds();
        var jwt_payload = new JObject{
                    { "iss", mAuthData["iss"]},
                    { "sub", mAuthData["sub"]},
                    { "aud", mAuthData["aud"]},
                    { "nbf", seconds_since_epoch - Const.JWT_CLIENT_SERVER_OFFSET_SEC},
                    { "iat", seconds_since_epoch - Const.JWT_CLIENT_SERVER_OFFSET_SEC},
                    { "exp", seconds_since_epoch + Const.JWT_VALIDITY_SEC},
                };
        // if client id starts with "aspera", add key "org" to jwt_payload
        if (mAuthData.ContainsKey("org") && mAuthData["client_id"].StartsWith("aspera"))
        {
            jwt_payload["org"] = mAuthData["org"];
        }
        Log.DumpJObject("jwt_payload", jwt_payload);
        string assertion = Jose.JWT.Encode(JsonConvert.SerializeObject(jwt_payload), private_key, Jose.JwsAlgorithm.RS256, extraHeaders: new Dictionary<string, object> { { "typ", "JWT" } });
        var token_parameters = new JObject{
            {"client_id",mAuthData["client_id"]},
            {"grant_type",Const.IETF_GRANT_JWT},
            {"assertion",assertion},
        };
        if (scope != null)
        {
            token_parameters["scope"] = scope;
        }
        Rest oauth_api = new Rest(mAuthData["token_url"]);
        oauth_api.setAuthBasic(mAuthData["client_id"], mAuthData["client_secret"]);
        //oauth_api.setHeader("Content-Type", Const.MIME_WWW);
        JObject data = (JObject)oauth_api.call(
            method: HttpMethod.Post,
            body: token_parameters,
            body_type: "www");
        return "Bearer " + (string)data["access_token"];
    }
    /// <summary>
    /// Call REST API.
    /// </summary>
    /// <param name="method">GET, ...</param>
    /// <param name="endpoint">endpoint</param>
    /// <param name="body"></param>
    /// <param name="query"></param>
    /// <param name="headers"></param>
    /// <returns></returns>
    /// <exception cref="System.Exception"></exception>
    public JContainer call(
        HttpMethod method,
        string endpoint = null,
        JObject body = null,
        string body_type = "json",
        JObject query = null,
        StringDict headers = null
        )
    {
        string uri_string = mBaseUrl;
        if (endpoint != null)
        {
            uri_string = uri_string + "/" + endpoint;
        }
        var builder = new System.UriBuilder(uri_string);
        if (query != null)
        {
            var q_dict = query.Properties().ToDictionary(p => p.Name, p => p.Value.ToString());
            string query_string = "";
            foreach (var key in q_dict.Keys)
            {
                if (query_string.Length != 0)
                {
                    query_string = query_string + "&";
                }
                query_string = query_string + System.Uri.EscapeDataString(key) + "=" + System.Uri.EscapeDataString("" + q_dict[key]);
            }
            builder.Query = query_string;
        }
        HttpRequestMessage request = new HttpRequestMessage
        {
            Method = method,
            RequestUri = builder.Uri
        };
        // depends on method
        foreach (var header in mHeaders)
        {
            request.Headers.Add(header.Key, header.Value);
        }
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue(Const.MIME_JSON));
        if (headers != null)
        {
            foreach (var header in headers)
            {
                request.Headers.Add(header.Key, header.Value);
            }
        }
        if (body != null)
        {
            Log.log.Debug($"body {body}");
            if (body_type == "www")
            {
                request.Content = new FormUrlEncodedContent(body.Properties().ToDictionary(p => p.Name, p => p.Value.ToString()));
            }
            else
            {
                request.Content = new StringContent(
                    JsonConvert.SerializeObject(body),
                    System.Text.Encoding.UTF8,
                    Const.MIME_JSON);
            }
        }
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
    public JContainer create(string endpoint, JObject body)
    {
        return call(method: HttpMethod.Post, endpoint: endpoint, body: body);
    }
    public JContainer read(string endpoint, JObject query = null)
    {
        return call(method: HttpMethod.Get, endpoint: endpoint, query: query);
    }
    public JContainer update(string endpoint, JObject body)
    {
        return call(method: HttpMethod.Put, endpoint: endpoint, body: body);
    }
    public JContainer delete(string endpoint)
    {
        return call(method: HttpMethod.Delete, endpoint: endpoint);
    }
    private string mBaseUrl;
    private StringDict mAuthData;
    private StringDict mHeaders;
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
}