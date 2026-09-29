# frozen_string_literal: true

require 'yaml'
require 'json'
require 'logger'
require 'tmpdir'
require 'base64'
require 'uri'
require 'net/http'
require 'singleton'

# Utilities of the samples: configuration, REST client, and transfer client.
module Utils
  # Configuration of the samples: parameters from the configuration file, files to transfer from the command line, and logging.
  class Configuration
    include Singleton

    # config file with sub-paths in project's root folder
    PATHS_FILE_REL = 'config/paths.yaml'
    DIR_TOP_VAR    = 'DIR_TOP'
    DEBUG_HTTP     = false
    # secrets in logs: value of JSON keys ending with one of those words, and JWT assertion in form parameters
    SECRETS_REGEX = /("[^"]*(?:assertion|authorization|password|private_key|secret|token)"\s*:\s*")[^"]+|(assertion=)[^&]+/
    class << self
      # @return [Boolean] true to show secrets in logs, set from configuration file (misc.show_secrets)
      attr_accessor :show_secrets
      # @return [Logger] logger of the samples, set on initialization
      attr_accessor :logger

      # Hide secrets in text for logs, unless configured to show them.
      # @param text [String] text that may contain secrets
      # @return [String] text with hidden secrets
      def mask_secrets(text)
        return text if show_secrets

        text.gsub(SECRETS_REGEX, '\1\2***')
      end

      # Log a named value: objects are displayed in JSON, and secrets are hidden.
      # @param name [String] name of the value
      # @param value [String, Object] value to log: a string, or an object displayed in JSON
      # @param level [Integer] log level, debug by default
      # @return [void]
      def log_dump(name, value, level: Logger::DEBUG)
        return if level < logger.level

        value = value.to_json unless value.is_a?(String)
        logger.add(level, "#{name}: #{mask_secrets(value)}")
      end

      # Create the value of an HTTP Basic Authorization header.
      # @param username [String] user name
      # @param password [String] password
      # @return [String] header value: `Basic <base64>`
      def basic_authorization(username, password)
        "Basic #{Base64.strict_encode64("#{username}:#{password}")}"
      end

      # Create an HTTP Basic Authorization header for a transfer spec V2.
      # @param username [String] user name
      # @param password [String] password
      # @return [Hash] header as `key` and `value`
      def basic_auth_header_key_value(username, password)
        {
          'key' => 'Authorization',
          'value' => basic_authorization(username, password)
        }
      end
    end
    # @return [String] folder for log files
    attr_reader :log_folder
    # @return [Logger] logger of the samples
    attr_reader :logger

    # Read the configuration file, and set up logging.
    def initialize
      @file_list = ARGV.dup
      raise ArgumentError, 'Missing arguments: files to transfer' if @file_list.empty?

      @top_folder = ENV[DIR_TOP_VAR]
      raise "Environment variable #{DIR_TOP_VAR} is not set" if @top_folder.nil?

      @top_folder = File.expand_path(@top_folder)
      raise "Folder not found: #{@top_folder}" unless File.directory?(@top_folder)

      @log_folder = Dir.tmpdir

      # read project's relative paths config file
      paths_file = File.join(@top_folder, *PATHS_FILE_REL.split('/'))
      @paths = YAML.safe_load(File.read(paths_file), aliases: true)

      # read main configuration
      main_cfg_path = get_path('main_config')
      @config = YAML.safe_load(File.read(main_cfg_path), aliases: true)

      # logging level
      level_name = param('misc', 'level')
      log_levels = { 'debug' => Logger::DEBUG, 'info' => Logger::INFO, 'warning' => Logger::WARN, 'error' => Logger::ERROR }
      raise "Invalid log level: #{level_name}" unless log_levels.key?(level_name)

      @logger = Logger.new($stdout)
      @logger.level = log_levels[level_name]
      @logger.formatter = proc do |severity, _datetime, _progname, msg|
        format("%-8s %s\n", severity, msg)
      end
      self.class.logger = @logger
      Rest.logger(@logger, http: DEBUG_HTTP) if defined?(Rest)
      self.class.show_secrets = param('misc', 'show_secrets', false)
    end

    # Get a parameter from the configuration file.
    # @param section [String] section in the configuration file
    # @param key [String] name of the parameter in the section
    # @param default [Object, nil] value if the parameter is not set, else the parameter is mandatory
    # @return [Object] value of the parameter
    def param(section, key, default = nil)
      sect = @config[section.to_s] || {}
      val = sect[key.to_s]
      return val unless val.nil?

      return default unless default.nil?

      raise KeyError, "Configuration parameter not found: #{section}.#{key}"
    end

    # Get the path of an item of the project, from the paths file.
    # @param name [String] name of the item in the paths file
    # @return [String] absolute path of the item, that must exist
    def get_path(name)
      rel = @paths[name] || @paths[name.to_s]
      raise KeyError, "Configuration parameter not found: #{name}" if rel.nil?

      item_path = File.join(@top_folder, *rel.to_s.split('/'))
      raise "File not found: #{item_path}" unless File.exist?(item_path)

      item_path
    end

    # Get the files to transfer, from the command line arguments.
    # @return [Array<String>] list of files
    attr_reader :file_list

    # Add the files to transfer, from the command line arguments, to the transfer spec.
    # @param t_spec [Hash] transfer spec to modify
    # @param path [String] path of the file list in the transfer spec: `paths` (V1) or `assets.paths` (V2)
    # @param destination [Object, nil] if set, add the file name as destination
    # @return [Hash] the transfer spec
    def add_sources(t_spec, path, destination: nil)
      keys = path.split('.')
      current = t_spec

      keys[0..-2].each do |k|
        current = current[k] || current[k.to_s]
        raise KeyError, "Invalid path in transfer spec: #{path}" unless current.is_a?(Hash)
      end

      leaf_key = keys[-1]
      # ensure we set the leaf to an array
      current[leaf_key] = []
      arr = current[leaf_key]

      @file_list.each do |f|
        src = { 'source' => f }
        src['destination'] = File.basename(f) unless destination.nil?
        arr << src
      end
      t_spec
    end
  end
end
