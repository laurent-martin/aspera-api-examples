//using System.Net.Http;
using System.Net.Http.Headers;
// for RSA
using System.Security.Cryptography;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using StringDict = System.Collections.Generic.Dictionary<string, string>;

/// <summary>
/// Constants of the REST client.
/// </summary>
public static class Const
{
    /// <summary>Time offset between client and server, in seconds: taken back from the start of validity of the JWT.</summary>
    public const int JWT_CLIENT_SERVER_OFFSET_SEC = 60;
    /// <summary>Validity of the JWT, in seconds.</summary>
    public const int JWT_VALIDITY_SEC = 600;
    /// <summary>MIME type of JSON.</summary>
    public const string MIME_JSON = "application/json";
    /// <summary>MIME type of form data.</summary>
    public const string MIME_WWW = "application/x-www-form-urlencoded";
    /// <summary>OAuth grant type of JWT Bearer.</summary>
    public const string IETF_GRANT_JWT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
}

/// <summary>
/// Simple REST client, with Basic or OAuth 2 JWT Bearer authentication.
/// </summary>
public class Rest
{
    /// <summary>
    /// Create a REST client.
    /// </summary>
    /// <param name="url">base URL of the API</param>
    public Rest(string url)
    {
        mBaseUrl = url;
        mVerify = true;
        mHttpClient = createHttpClient();
        mHeaders = new StringDict();
    }
    /// <summary>
    /// Enable or disable the verification of the server certificate.
    /// </summary>
    /// <param name="verify">false for development servers with a self-signed certificate</param>
    public void setVerify(bool verify)
    {
        mVerify = verify;
        mHttpClient = createHttpClient();
    }
    /// <summary>
    /// Create the HTTP client, with or without verification of the server certificate.
    /// </summary>
    /// <returns>HTTP client</returns>
    private HttpClient createHttpClient()
    {
        var handler = new HttpClientHandler();
        if (!mVerify)
        {
            handler.ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator;
        }
        return new HttpClient(handler)
        {
            BaseAddress = new Uri(mBaseUrl)
        };
    }
    /// <summary>
    /// Use Basic authentication.
    /// </summary>
    /// <param name="username">user name</param>
    /// <param name="password">password</param>
    public void setAuthBasic(string username, string password)
    {
        mHeaders.Add("Authorization", "Basic " + Convert.ToBase64String(System.Text.Encoding.ASCII.GetBytes(username + ":" + password)));
        //var encoded = Convert.ToBase64String(System.Text.ASCIIEncoding.ASCII.GetBytes($"{mAuthData["basic_username"]}:{mAuthData["basic_password"]}"));
        //request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", encoded);
    }

    /// <summary>
    /// Use OAuth 2 Bearer authentication, with a JWT signed with a private key.
    /// </summary>
    /// <param name="auth"><c>token_url</c>, <c>key_pem_path</c>, <c>client_id</c>, <c>client_secret</c>, <c>iss</c>, <c>aud</c>, <c>sub</c>, and optionally <c>org</c></param>
    public void setAuthBearer(StringDict auth)
    {
        // shallow copy sufficient here
        mAuthData = auth.ToDictionary(entry => entry.Key, entry => entry.Value);
    }
    /// <summary>
    /// Generate a bearer token, and use it for all subsequent requests.
    /// A new token is generated for each execution of the sample.
    /// In real code, the token should be reused until it expires.
    /// </summary>
    /// <param name="scope">OAuth scope of the token, or none</param>
    public void setDefaultScope(string? scope)
    {
        mHeaders.Add("Authorization", get_bearer_token(scope));
    }
    /// <summary>
    /// Add a header to all subsequent requests.
    /// </summary>
    /// <param name="name">header name</param>
    /// <param name="value">header value</param>
    public void setHeader(string name, string value)
    {
        mHeaders.Add(name, value);
    }
    /// <summary>
    /// Generate a bearer token, with the JWT Bearer grant.
    /// </summary>
    /// <param name="scope">OAuth scope of the token, or none</param>
    /// <returns>value of the Authorization header: <c>Bearer &lt;token&gt;</c></returns>
    public string get_bearer_token(string? scope)
    {
        var authData = mAuthData ?? throw new InvalidOperationException("Auth data not set");
        RSA private_key = readKeyFromFile(authData["key_pem_path"]);
        long seconds_since_epoch = System.DateTimeOffset.Now.ToUnixTimeSeconds();
        var jwt_payload = new JObject{
                    { "iss", authData["iss"]},
                    { "sub", authData["sub"]},
                    { "aud", authData["aud"]},
                    { "nbf", seconds_since_epoch - Const.JWT_CLIENT_SERVER_OFFSET_SEC},
                    { "iat", seconds_since_epoch - Const.JWT_CLIENT_SERVER_OFFSET_SEC},
                    { "exp", seconds_since_epoch + Const.JWT_VALIDITY_SEC},
                    { "jti", Guid.NewGuid().ToString()},
                };
        // if client id starts with "aspera", add key "org" to jwt_payload
        if (authData.ContainsKey("org") && authData["client_id"].StartsWith("aspera"))
        {
            jwt_payload["org"] = authData["org"];
        }
        string assertion = Jose.JWT.Encode(JsonConvert.SerializeObject(jwt_payload), private_key, Jose.JwsAlgorithm.RS256, extraHeaders: new Dictionary<string, object> { { "typ", "JWT" } });
        var token_parameters = new JObject{
            {"client_id",authData["client_id"]},
            {"grant_type",Const.IETF_GRANT_JWT},
            {"assertion",assertion},
        };
        if (scope != null)
        {
            token_parameters["scope"] = scope;
        }
        Rest oauth_api = new Rest(authData["token_url"]);
        oauth_api.setVerify(mVerify);
        oauth_api.setAuthBasic(authData["client_id"], authData["client_secret"]);
        //oauth_api.setHeader("Content-Type", Const.MIME_WWW);
        JObject data = (JObject)oauth_api.call(
            method: HttpMethod.Post,
            body: token_parameters,
            body_type: "www");
        return "Bearer " + ((string?)data["access_token"] ?? throw new Exception("No access_token in token response"));
    }
    /// <summary>
    /// Call the API: send a request, and get the response data.
    /// </summary>
    /// <param name="method">HTTP method</param>
    /// <param name="endpoint">path of the endpoint, relative to the base URL</param>
    /// <param name="body">request data</param>
    /// <param name="body_type">format of the request data: <c>json</c> or <c>www</c> (form)</param>
    /// <param name="query">query parameters</param>
    /// <param name="headers">additional headers</param>
    /// <returns>response data, or an empty object if the response is empty</returns>
    public JContainer call(
        HttpMethod method,
        string? endpoint = null,
        JObject? body = null,
        string body_type = "json",
        JObject? query = null,
        StringDict? headers = null
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
        Log.log.Debug($"HTTP {method.Method} {uri_string}");
        if (request.Content != null)
        {
            Log.Dump("Request body", request.Content.ReadAsStringAsync().Result);
        }
        var response = mHttpClient.SendAsync(request).Result;
        var resp_str = response.Content.ReadAsStringAsync().Result;
        if (!response.IsSuccessStatusCode)
        {
            throw new Exception($"HTTP {(int)response.StatusCode} for {method.Method} {uri_string}: {resp_str}");
        }
        if (resp_str.Length != 0)
        {
            Log.Dump("Response body", resp_str);
        }
        // empty response (e.g. PUT, DELETE): empty object
        JContainer result = new JObject();
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
    /// <summary>
    /// Create a resource (HTTP POST).
    /// </summary>
    /// <param name="endpoint">path of the endpoint, relative to the base URL</param>
    /// <param name="body">request data, sent in JSON</param>
    /// <returns>response data</returns>
    public JContainer create(string endpoint, JObject body)
    {
        return call(method: HttpMethod.Post, endpoint: endpoint, body: body);
    }
    /// <summary>
    /// Read a resource (HTTP GET).
    /// </summary>
    /// <param name="endpoint">path of the endpoint, relative to the base URL</param>
    /// <param name="query">query parameters</param>
    /// <returns>response data</returns>
    public JContainer read(string endpoint, JObject? query = null)
    {
        return call(method: HttpMethod.Get, endpoint: endpoint, query: query);
    }
    /// <summary>
    /// Update a resource (HTTP PUT).
    /// </summary>
    /// <param name="endpoint">path of the endpoint, relative to the base URL</param>
    /// <param name="body">request data, sent in JSON</param>
    /// <returns>response data</returns>
    public JContainer update(string endpoint, JObject body)
    {
        return call(method: HttpMethod.Put, endpoint: endpoint, body: body);
    }
    /// <summary>
    /// Delete a resource (HTTP DELETE).
    /// </summary>
    /// <param name="endpoint">path of the endpoint, relative to the base URL</param>
    /// <returns>response data</returns>
    public JContainer delete(string endpoint)
    {
        return call(method: HttpMethod.Delete, endpoint: endpoint);
    }
    private string mBaseUrl;
    // set by setAuthBearer
    private StringDict? mAuthData;
    private StringDict mHeaders;
    private HttpClient mHttpClient;
    private bool mVerify;

    /// <summary>
    /// Read a RSA private key from a PEM file: PKCS#1 <c>RSA PRIVATE KEY</c> or PKCS#8 <c>PRIVATE KEY</c>.
    /// </summary>
    /// <param name="filename">path of the key file</param>
    /// <returns>private key</returns>
    private static RSA readKeyFromFile(string filename)
    {
        RSA rsa = RSA.Create();
        rsa.ImportFromPem(System.IO.File.ReadAllText(filename));
        return rsa;
    }
}