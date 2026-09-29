# frozen_string_literal: true

require 'rest-client'
require 'jwt'
require 'json'
require 'securerandom'
require 'logger'
require 'openssl'
require 'time'

require 'net/http'

module Utils
  # Simple REST client, with Basic or OAuth 2 JWT Bearer authentication.
  class Rest
    # @return [String] base URL of the API
    attr_accessor :base_url
    # @return [Hash, nil] parameters of Bearer authentication
    attr_accessor :auth_data
    # @return [Boolean] false for development servers with a self-signed certificate
    attr_accessor :verify
    # @return [Hash] headers of all requests
    attr_accessor :headers

    # Constants
    JWT_CLIENT_SERVER_OFFSET_SEC = 60
    JWT_VALIDITY_SEC = 600
    MIME_JSON = 'application/json'
    MIME_WWW = 'application/x-www-form-urlencoded'
    IETF_GRANT_JWT = 'urn:ietf:params:oauth:grant-type:jwt-bearer'

    class << self
      # Set the logger.
      # @param logger [Logger] logger of the samples
      # @param http [Boolean] true to log HTTP exchanges
      # @return [void]
      def logger(logger, http: false)
        @logger = logger
        return unless http

        RestClient.log = logger
        # Enable global Net::HTTP debug output
        Net::HTTP.class_eval do
          alias_method :orig_initialize, :initialize
          def initialize(*args, &block)
            orig_initialize(*args, &block)
            @debug_output = $stderr
          end
        end
      end

      # @return [Logger] logger of the samples
      def log
        @logger
      end
    end

    # Create a REST client.
    # @param base_url [String] base URL of the API
    def initialize(base_url)
      @base_url = base_url
      @auth_data = nil
      @verify = true
      @headers = {}
    end

    # Add headers to all subsequent requests.
    # @param headers [Hash] header names and values
    # @return [void]
    def add_headers(headers)
      @headers.merge!(headers)
    end

    # Use Basic authentication.
    # @param user [String] user name
    # @param password [String] password
    # @return [void]
    def auth_basic(user, password)
      @auth_data = nil
      token = ["#{user}:#{password}"].pack('m0') # base64 without newline
      @headers['Authorization'] = "Basic #{token}"
    end

    # Use OAuth 2 Bearer authentication, with a JWT signed with a private key.
    # @param token_url [String] URL of the token endpoint
    # @param key_pem_path [String] path of the private key, in PEM format
    # @param aud [String] audience of the JWT
    # @param iss [String] issuer of the JWT
    # @param sub [String] subject of the JWT
    # @param client_id [String] OAuth client id
    # @param client_secret [String, nil] OAuth client secret
    # @param org [String, nil] organization, for AoC
    # @return [void]
    def auth_bearer(token_url:, key_pem_path:, aud:, iss:, sub:, client_id:, client_secret: nil, org: nil)
      @auth_data = {
        token_url: token_url,
        client_id: client_id,
        key_pem_path: key_pem_path,
        aud: aud,
        iss: iss,
        sub: sub
      }
      @auth_data[:client_secret] = client_secret if client_secret
      @auth_data[:org] = org if org
    end

    # Generate a bearer token, and use it for all subsequent requests.
    # A new token is generated for each execution of the sample.
    # In real code, the token should be reused until it expires.
    # @param scope [String, nil] OAuth scope of the token, or none
    # @return [void]
    def default_scope(scope = nil)
      @headers['Authorization'] = bearer_token_authorization(scope)
    end

    # Generate a bearer token, with the JWT Bearer grant.
    # @param scope [String, nil] OAuth scope of the token, or none
    # @return [String] value of the Authorization header: `Bearer <token>`
    def bearer_token_authorization(scope = nil)
      raise 'Auth data not set' unless @auth_data

      private_key_pem = File.read(@auth_data[:key_pem_path])
      private_key = OpenSSL::PKey::RSA.new(private_key_pem)

      seconds_since_epoch = Time.now.to_i

      jwt_payload = {
        iss: @auth_data[:iss],
        sub: @auth_data[:sub],
        aud: @auth_data[:aud],
        iat: seconds_since_epoch - JWT_CLIENT_SERVER_OFFSET_SEC,
        nbf: seconds_since_epoch - JWT_CLIENT_SERVER_OFFSET_SEC,
        exp: seconds_since_epoch + JWT_VALIDITY_SEC,
        jti: SecureRandom.uuid
      }
      jwt_payload[:org] = @auth_data[:org] if @auth_data[:org]

      assertion = JWT.encode(jwt_payload, private_key, 'RS256', { typ: 'JWT' })

      token_parameters = {
        client_id: @auth_data[:client_id],
        grant_type: IETF_GRANT_JWT,
        assertion: assertion
      }
      token_parameters[:scope] = scope if scope

      response = execute(
        method: :post,
        url: @auth_data[:token_url],
        user: @auth_data[:client_id],
        password: @auth_data[:client_secret],
        payload: URI.encode_www_form(token_parameters),
        headers: {
          content_type: MIME_WWW,
          accept: MIME_JSON,
          accept_encoding: 'identity' # no compression for debug
        },
        verify_ssl: @verify
      )
      response_data = JSON.parse(response.body)
      "Bearer #{response_data['access_token']}"
    end

    # Call the API: send a request, and get the response data.
    # @param method [Symbol] HTTP method
    # @param endpoint [String, nil] path of the endpoint, relative to the base URL
    # @param body [Hash, nil] request data, sent in JSON
    # @param query [Hash, nil] query parameters
    # @param headers [Hash, nil] additional headers
    # @return [Object, nil] response data, or none if the response is empty
    def call(
      method,
      endpoint: nil,
      body: nil,
      query: nil,
      headers: nil
    )
      url = endpoint ? "#{@base_url}/#{endpoint}" : @base_url
      req_headers = {}
      req_headers['Accept'] = MIME_JSON unless %w[PUT DELETE].include?(method.to_s.upcase)
      req_headers['Content-Type'] = MIME_JSON if %w[POST PUT].include?(method.to_s.upcase)
      req_headers.merge!(@headers)
      req_headers.merge!(headers) if headers
      params = {
        method: method,
        url: url,
        query: query,
        headers: req_headers,
        verify_ssl: @verify
      }
      params[:payload] = body.to_json if body
      response = execute(**params)
      return nil if %w[PUT DELETE].include?(method.to_s.upcase)

      JSON.parse(response.body)
    end

    # Create a resource (HTTP POST).
    # @param endpoint [String] path of the endpoint, relative to the base URL
    # @param data [Hash] request data, sent in JSON
    # @return [Object] response data
    def create(endpoint, data)
      call(:post, endpoint: endpoint, body: data)
    end

    # Read a resource (HTTP GET).
    # @param endpoint [String] path of the endpoint, relative to the base URL
    # @param params [Hash, nil] query parameters
    # @return [Object] response data
    def read(endpoint, params = nil)
      call(:get, endpoint: endpoint, query: params)
    end

    # Update a resource (HTTP PUT).
    # @param endpoint [String] path of the endpoint, relative to the base URL
    # @param data [Hash] request data, sent in JSON
    # @return [nil]
    def update(endpoint, data)
      call(:put, endpoint: endpoint, body: data)
    end

    # Delete a resource (HTTP DELETE).
    # @param endpoint [String] path of the endpoint, relative to the base URL
    # @return [nil]
    def delete(endpoint)
      call(:delete, endpoint: endpoint)
    end

    private

    # Send an HTTP request, log request and response bodies, and raise an exception on error.
    # @param method [Symbol] HTTP method
    # @param url [String] URL without query
    # @param query [Hash, nil] query parameters
    # @param params [Hash] parameters of `RestClient::Request.execute`
    # @return [RestClient::Response] HTTP response
    def execute(method:, url:, query: nil, **params)
      method = method.to_s.upcase
      log = self.class.log
      log.debug("HTTP #{method} #{url}")
      Configuration.log_dump('Request body', params[:payload]) if params[:payload]
      full_url = query ? "#{url}?#{URI.encode_www_form(query)}" : url
      response = RestClient::Request.execute(method: method.downcase.to_sym, url: full_url, **params)
      Configuration.log_dump('Response body', response.body) unless response.body.empty?
      response
    rescue RestClient::ExceptionWithResponse => e
      raise "HTTP #{e.http_code} for #{method} #{url}: #{e.response&.body}"
    end
  end
end
