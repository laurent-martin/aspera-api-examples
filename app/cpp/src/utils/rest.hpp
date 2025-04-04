#pragma once

#include <openssl/evp.h>
#include <openssl/pem.h>

#include <boost/algorithm/string.hpp>
#include <boost/asio.hpp>
#include <boost/asio/ssl.hpp>
#include <boost/beast.hpp>
#include <boost/json.hpp>
#include <boost/url.hpp>
#include <boost/url/encode.hpp>
#include <boost/url/parse.hpp>
#include <boost/url/rfc/pchars.hpp>
#include <fstream>
#include <stdexcept>
#include <string>

#include "configuration.hpp"

namespace json = boost::json;
namespace http = boost::beast::http;
namespace ssl = boost::asio::ssl;

namespace utils {
inline constexpr const int HTTP_1_1 = 11;
inline constexpr const int JWT_CLIENT_SERVER_OFFSET_SEC = 60;
inline constexpr const int JWT_VALIDITY_SEC = 600;
inline constexpr const char* const MIME_JSON = "application/json";
inline constexpr const char* const MIME_WWW = "application/x-www-form-urlencoded";
inline constexpr const char* const IETF_GRANT_JWT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
inline const json::object empty_value;

enum BodyType {
    NONE,
    JSON,
    WWW
};

inline std::string attribute_str(json::object& dict, const std::string& key) {
    return dict.at(key).as_string().c_str();
}

// simple REST client using boost
class Rest {
   private:
    // base url, including possibly path
    const std::string _base_url;
    std::unordered_map<http::field, std::string> _headers;
    std::unordered_map<std::string, std::string> _auth_data;
    bool _verify;

   public:
    Rest(std::string base_url)
        : _base_url(base_url),
          _headers(),
          _auth_data(),
          _verify(true) {
    }
    void set_verify(bool verify) {
        _verify = verify;
    }
    void add_headers() {}

    void set_auth_basic(const std::string& user, const std::string& pass) {
        _headers.insert({http::field::authorization, basic_auth_header(user, pass)});
    }

    void set_auth_bearer(const std::unordered_map<std::string, std::string>& auth_data) {
        const std::set<std::string> mandatory_keys = {
            "token_url", "aud", "client_id", "client_secret",
            "key_pem_path", "iss", "sub"};
        std::set<std::string> missing_keys;
        std::copy_if(mandatory_keys.begin(), mandatory_keys.end(),
                     std::inserter(missing_keys, missing_keys.end()),
                     [&](const std::string& key) { return auth_data.find(key) == auth_data.end(); });
        if (!missing_keys.empty()) {
            std::ostringstream oss;
            oss << "Missing mandatory keys in auth_data: ";
            std::copy(missing_keys.begin(), missing_keys.end(),
                      std::ostream_iterator<std::string>(oss, " "));
            throw std::invalid_argument(oss.str());
        }
        _auth_data = auth_data;
    }

    void set_default_scope(const std::string& scope) {
        _headers.insert({http::field::authorization, get_bearer_token(scope)});
    }

    std::string get_bearer_token(const std::string& scope) {
        std::string private_key_pem = read_file(_auth_data.at("key_pem_path"));

        auto seconds_since_epoch = std::time(nullptr);

        json::object jwt_payload = {
            {"iss", _auth_data.at("iss")},
            {"sub", _auth_data.at("sub")},
            {"aud", _auth_data.at("aud")},
            {"iat", seconds_since_epoch - JWT_CLIENT_SERVER_OFFSET_SEC},
            {"exp", seconds_since_epoch + JWT_VALIDITY_SEC},
            {"jti", uuid_random()}};

        if (_auth_data.find("org") != _auth_data.end()) {
            jwt_payload.insert_or_assign("org", _auth_data.at("org"));
        }

        json::object token_parameters = {
            {"client_id", _auth_data.at("client_id")},
            {"grant_type", IETF_GRANT_JWT},
            {"assertion", jwt_encode(jwt_payload, private_key_pem, "RS256", json::object{{"typ", "JWT"}})}};
        if (!scope.empty()) {
            token_parameters.insert_or_assign("scope", scope);
        }
        LOG(debug) << "parameters: " << token_parameters;

        Rest oauth_api(_auth_data.at("token_url"));
        oauth_api.set_verify(_verify);
        oauth_api.set_auth_basic(_auth_data.at("client_id"), _auth_data.at("client_secret"));
        json::object response = oauth_api.call(http::verb::post, "", token_parameters, BodyType::WWW).as_object();
        return "Bearer " + static_cast<std::string>(response.at("access_token").as_string());
    }

    json::value call(
        const http::verb method,
        const std::string& endpoint = "",
        const json::value& body = empty_value,
        BodyType body_type = BodyType::NONE,
        const json::object& query = empty_value  //
    ) {
        LOG(debug) << "Calling: " << method << " on " << endpoint;
        const auto base_uri = boost::urls::parse_uri(_base_url).value();
        std::string port = base_uri.port();
        if (port.empty()) {
            if (base_uri.scheme() == "https")
                port = "443";
            else
                throw std::runtime_error("Port not specified in URL");
        }
        std::string endpoint_full_path = base_uri.path();
        if (!endpoint.empty())
            endpoint_full_path += "/" + endpoint;
        if (!query.empty()) {
            endpoint_full_path += "?" + build_query(query);
        }
        http::request<http::string_body> request{method, endpoint_full_path, HTTP_1_1};
        request.set(http::field::host, base_uri.host());
        request.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
        switch (body_type) {
            case BodyType::NONE:
                break;
            case BodyType::JSON: {
                request.set(http::field::content_type, MIME_JSON);
                request.body() = json::serialize(body);
                request.prepare_payload();
                break;
            }
            case BodyType::WWW:
                request.set(http::field::content_type, MIME_WWW);
                request.body() = build_query(body.as_object());
                request.prepare_payload();
                break;
        }
        bool result_json = false;
        switch (method) {
            case http::verb::post:
            case http::verb::get:
                request.set(http::field::accept, MIME_JSON);
                result_json = true;
                break;
            default:
                break;
        }
        for (const auto& [key, value] : _headers) {
            request.set(key, value);
        }
        LOG(debug) << "Request: " << request;
        boost::asio::io_context io_svc;
        ssl::context ssl_context(ssl::context::tls_client);
        ssl_context.set_options(boost::asio::ssl::context::default_workarounds | boost::asio::ssl::context::tlsv13);
        ssl::stream<boost::asio::ip::tcp::socket> sock_stream = {io_svc, ssl_context};
        // Set SNI Hostname (many hosts need this to handshake successfully)
        if (!SSL_set_tlsext_host_name(sock_stream.native_handle(), base_uri.host().c_str())) {
            boost::system::error_code ec{static_cast<int>(::ERR_get_error()), boost::asio::error::get_ssl_category()};
            throw boost::system::system_error{ec};
        }
        boost::asio::ip::tcp::resolver resolver(io_svc);
        auto it = resolver.resolve(base_uri.host(), port);
        connect(sock_stream.lowest_layer(), it);
        sock_stream.handshake(ssl::stream_base::handshake_type::client);
        http::write(sock_stream, request);

        http::response<http::string_body> response;
        boost::beast::flat_buffer buffer;
        http::read(sock_stream, buffer, response);
        boost::system::error_code ec;
        sock_stream.shutdown(ec);
        if (ec == boost::asio::error::eof || ec == ssl::error::stream_truncated) {
            ec.assign(0, ec.category());
        }
        if (ec)
            throw boost::system::system_error{ec};
        LOG(debug) << "Code: " << response.result_int();
        // check HTTP status is success
        if (response.result_int() >= 300) {
            LOG(debug) << "Response: " << response.body();
            throw std::runtime_error("HTTP error: " + std::to_string(response.result_int()));
        }
        LOG(debug) << "Result: " << response.body();
        if (result_json) {
            return json::parse(response.body());
        }
        return empty_value;
    }
    json::value create(std::string endpoint, json::value body, json::object query = empty_value) {
        return call(http::verb::post, endpoint, body, BodyType::JSON, query);
    }
    json::value read(std::string endpoint, json::object query = empty_value) {
        return call(http::verb::get, endpoint, empty_value, BodyType::NONE, query);
    }
    json::value update(std::string endpoint, json::value body) {
        return call(http::verb::put, endpoint, body, BodyType::JSON);
    }
    void delete_(std::string endpoint) {
        call(http::verb::delete_, endpoint);
    }
    // Create a basic auth header
    static inline std::string basic_auth_header(const std::string& username, const std::string& password) {
        return "Basic " + base64_encode(username + ":" + password);
    }
    static std::string base64url_encode(const std::string& input) {
        std::string encoded = base64_encode(input);
        // Replace characters to make it URL-safe and remove padding
        std::replace(encoded.begin(), encoded.end(), '+', '-');
        std::replace(encoded.begin(), encoded.end(), '/', '_');
        encoded.erase(std::remove(encoded.begin(), encoded.end(), '='), encoded.end());
        return encoded;
    }

    static std::string sign_with_rsa(const std::string& data, const std::string& key_pem) {
        BIO* bio = BIO_new_mem_buf(key_pem.data(), -1);
        EVP_PKEY* pkey = PEM_read_bio_PrivateKey(bio, nullptr, nullptr, nullptr);
        BIO_free(bio);
        if (!pkey) {
            throw std::runtime_error("Failed to load private key.");
        }
        EVP_MD_CTX* md_ctx = EVP_MD_CTX_new();
        EVP_PKEY_CTX* pkey_ctx;
        EVP_DigestSignInit(md_ctx, &pkey_ctx, EVP_sha256(), nullptr, pkey);
        EVP_DigestSignUpdate(md_ctx, data.c_str(), data.size());
        size_t sig_len;
        EVP_DigestSignFinal(md_ctx, nullptr, &sig_len);
        std::string signature(sig_len, '\0');
        EVP_DigestSignFinal(md_ctx, reinterpret_cast<unsigned char*>(&signature[0]), &sig_len);
        EVP_MD_CTX_free(md_ctx);
        EVP_PKEY_free(pkey);
        return base64url_encode(signature);
    }

    static std::string jwt_encode(
        const json::object& payload,
        const std::string& key_pem,
        const std::string& alg,
        const json::object& header = {}) {
        json::object full_header = header;
        full_header.insert_or_assign("alg", alg);
        std::string unsigned_token = base64url_encode(json::serialize(full_header)) + "." + base64url_encode(json::serialize(payload));
        std::string signature = sign_with_rsa(unsigned_token, key_pem);
        return unsigned_token + "." + signature;
    }
    static std::string read_file(const std::string& file_path) {
        std::ifstream file_stream(file_path);
        if (!file_stream.is_open()) {
            throw std::runtime_error("Could not open file: " + file_path);
        }
        return std::string((std::istreambuf_iterator<char>(file_stream)), std::istreambuf_iterator<char>());
    }
    static std::string build_query(const json::object& query) {
        std::string query_string;
        for (const auto& [key, val] : query) {
            if (!query_string.empty()) query_string += '&';
            query_string += boost::urls::encode(key, boost::urls::pchars) + '=' +
                            boost::urls::encode(val.as_string(), boost::urls::pchars);
        }
        return query_string;
    }
};
}  // namespace utils
