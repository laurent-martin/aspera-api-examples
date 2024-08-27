#pragma once

#include <boost/asio.hpp>
#include <boost/asio/ssl.hpp>
#include <boost/beast.hpp>
#include <boost/json.hpp>

#define HTTP_1_1 11
#define MIME_TYPE_JSON "application/json"

namespace json = boost::json;
namespace http = boost::beast::http;
namespace ssl = boost::asio::ssl;

// simple REST client using boost
class Rest {
   private:
    // base url, including possibly path
    const std::string _base_url;
    // Authorization header
    std::string _authorization;

   public:
    Rest(std::string base_url) : _base_url(base_url), _authorization() {}

    void set_basic(const std::string& user, const std::string& pass) {
        _authorization = basic_auth_header(user, pass);
    }

    json::object post(std::string subpath, json::object payload) {
        const std::string json_body = json::serialize(payload);
        const auto base_uri = boost::urls::parse_uri(_base_url).value();
        std::string port = base_uri.port();
        if (port.empty()) {
            if (base_uri.scheme() == "https")
                port = "443";
            else
                throw std::runtime_error("Port not specified in URL");
        }
        const std::string path = base_uri.path() + "/" + subpath;
        boost::asio::io_service io_svc;
        ssl::context ssl_context(ssl::context::sslv23_client);
        ssl::stream<boost::asio::ip::tcp::socket> sock_stream = {io_svc, ssl_context};
        boost::asio::ip::tcp::resolver resolver(io_svc);
        auto it = resolver.resolve(base_uri.host(), port);
        connect(sock_stream.lowest_layer(), it);
        sock_stream.handshake(ssl::stream_base::handshake_type::client);
        http::request<http::string_body> request{http::verb::post, path, HTTP_1_1};
        request.set(http::field::host, base_uri.host());
        request.set(http::field::user_agent, BOOST_BEAST_VERSION_STRING);
        if (!_authorization.empty())
            request.set(http::field::authorization, _authorization);
        request.set(http::field::content_type, MIME_TYPE_JSON);
        request.set(http::field::accept, MIME_TYPE_JSON);
        request.set(http::field::content_length, std::to_string(json_body.size()));
        request.body() = json_body;
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
        return json::parse(response.body()).as_object();
    }
    // Create a basic auth header
    static inline std::string basic_auth_header(const std::string& username, const std::string& password) {
        std::string credentials = username + ":" + password;
        std::string encoded_credentials;
        encoded_credentials.resize(boost::beast::detail::base64::encoded_size(credentials.size()));
        boost::beast::detail::base64::encode(encoded_credentials.data(), credentials.data(), credentials.size());
        return "Basic " + encoded_credentials;
    }
};
