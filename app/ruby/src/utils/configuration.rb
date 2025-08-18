# frozen_string_literal: true

require 'yaml'
require 'logger'
require 'tmpdir'
require 'base64'
require 'uri'
require 'net/http'
require 'singleton'

module Utils
  class Configuration
    include Singleton

    # config file with sub-paths in project's root folder
    PATHS_FILE_REL = 'config/paths.yaml'
    DIR_TOP_VAR    = 'DIR_TOP'
    DEBUG_HTTP     = false
    class << self
      def basic_authorization(username, password)
        "Basic #{Base64.strict_encode64("#{username}:#{password}")}"
      end

      def basic_auth_header_key_value(username, password)
        {
          'key' => 'Authorization',
          'value' => basic_authorization(username, password)
        }
      end

      def last_file_line(filename)
        # Efficiently read the last line without loading entire file
        File.open(filename, 'rb') do |f|
          return '' if f.size.zero?

          pos = -1
          buf = +''
          loop do
            f.seek(pos, IO::SEEK_END)
            char = f.read(1)
            # Stop once we've collected a line and hit a newline (skip trailing newline-only cases)
            break if char == "\n" && !buf.empty?

            buf.prepend(char)
            pos -= 1
            break if f.pos <= 1 # reached start
          end
          buf.encode('UTF-8', invalid: :replace, undef: :replace)
        end
      end
    end
    # Expose a few internals to stay close to Python version
    attr_reader :log_folder, :logger

    def initialize
      @file_list = ARGV.dup
      raise ArgumentError, "ERROR: Usage: #{$PROGRAM_NAME} <files to send>" if @file_list.empty?

      @top_folder = ENV[DIR_TOP_VAR]
      raise EnvironmentError, "Environment variable #{DIR_TOP_VAR} is not set." if @top_folder.nil?

      @top_folder = File.expand_path(@top_folder)
      unless File.directory?(@top_folder)
        raise NotADirectoryError,
              "The folder specified by #{DIR_TOP_VAR} does not exist or is not a directory: #{@top_folder}"
      end

      @log_folder = Dir.tmpdir

      # read project's relative paths config file
      paths_file = File.join(@top_folder, *PATHS_FILE_REL.split('/'))
      @paths = YAML.safe_load(File.read(paths_file), aliases: true)

      # read main configuration
      main_cfg_path = get_path('main_config')
      @config = YAML.safe_load(File.read(main_cfg_path), aliases: true)

      # logging level
      level_name = param('misc', 'level', 'WARN').to_s.upcase
      level_const = begin
        Logger.const_get(level_name)
      rescue StandardError
        Logger::WARN
      end
      @logger = Logger.new($stdout)
      @logger.tap { |l| l.level = level_const } # initialize root logger formatting if needed
      @logger.formatter = proc do |severity, _datetime, _progname, msg|
        format("%-8s %s\n", severity, msg)
      end
      Rest.logger(@logger, http: DEBUG_HTTP) if defined?(Rest)
    end

    def param(section, key, default = nil)
      sect = @config[section] || @config[section.to_s]
      raise KeyError, "Section not found: #{section}" if sect.nil?

      val = sect[key] || sect[key.to_s]
      return val unless val.nil?

      return default unless default.nil?

      raise KeyError, "Param not found: #{key}"
    end

    # Get configuration sub-path in project's root folder
    def get_path(name)
      rel = @paths[name] || @paths[name.to_s]
      raise KeyError, "Path key not found: #{name}" if rel.nil?

      item_path = File.join(@top_folder, *rel.to_s.split('/'))
      raise "ERROR: #{item_path} not found." unless File.exist?(item_path)

      item_path
    end

    # Get list of files to transfer (from CLI args)
    attr_reader :file_list

    # Add source file list to transfer spec.
    # `path` is like 'paths' (V1) or 'assets.paths' (V2).
    def add_sources(t_spec, path, destination: nil)
      keys = path.split('.')
      current = t_spec

      keys[0..-2].each do |k|
        current = current[k] || current[k.to_s]
        raise KeyError, "key is not a dict: #{k}" unless current.is_a?(Hash)
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
