# frozen_string_literal: true

require 'yaml'
require 'singleton'
require 'json'
require 'tmpdir'
require 'aspera/log'
require 'aspera/agent/direct'
require 'aspera/ascp/installation'
require 'aspera/rest'
require 'aspera/rest_errors_aspera'

# setup test env
class Configuration
  include Singleton
  attr_reader :top_folder, :config, :files, :agent

  PATHS_FILE_REL = 'config/paths.yaml'

  private_constant :PATHS_FILE_REL

  def initialize
    unless ARGV.length.eql?(1)
      log.error { "Wrong number of args: #{ARGV.length}" }
      log.error { "Usage: #{$PROGRAM_NAME} <file to send>" }
      Process.exit(1)
    end
    @files = [ARGV[0]]
    @top_folder = ENV['DIR_TOP']
    raise 'Environment variable DIR_TOP is not set.' if @top_folder.nil? || @top_folder.empty?

    @top_folder = File.expand_path(@top_folder)
    unless File.directory?(@top_folder)
      raise "The folder specified by DIR_TOP does not exist or is not a directory: #{@top_folder}"
    end

    @paths = YAML.load_file(File.join(@top_folder, PATHS_FILE_REL))
    @config = YAML.load_file(get_path('main_config'))
    log.debug("config: #{@config}")
    raise "Missing config file: #{get_path('main_config')}" unless @config['misc']

    # some required files are generated here (keys, certs)
    Aspera::Ascp::Installation.instance.sdk_folder = get_path('temp')
    # get Transfer Agent
    @agent = Aspera::Agent::Direct.new

    ##############################################################
    # generic initialization : configuration of FaspManager

    # set path to your copy of ascp binary (else, let the system find)
    # Aspera::Fasp::Installation.instance.ascp_path = ENV['ascp'] if ENV.key?('ascp')
    # another way is to detect installed products and use one of them
    # Aspera::Fasp::Installation.instance.installed_products.each{|p|puts("found: #{p[:name]}")}
    # Aspera::Fasp::Installation.instance.use_ascp_from_product('Aspera Connect')

    # Note that it would also be possible to start transfers using other agents
    # require 'aspera/fasp/connect'
    # transfer_agent=Aspera::Fasp::Connect.new
    # require 'aspera/fasp/node'
    # transfer_agent=Aspera::Fasp::Node.new(Aspera::Rest.new(...))
    Aspera::Log.instance.level = conf('misc', 'level').to_sym
    Aspera::SecretHider.log_secrets = true
    # register aspera REST call error handlers
    Aspera::RestErrorsAspera.register_handlers
    # ignore self signed cert
    Aspera::RestParameters.instance.session_cb = ->(http) { http.verify_mode = OpenSSL::SSL::VERIFY_NONE }
  end

  def conf(*keys, optional: false)
    current_node = @config
    keys.each do |key|
      if current_node.key?(key)
        current_node = current_node[key]
      elsif optional
        return nil
      else
        raise KeyError, "Key not found: #{key}"
      end
    end
    current_node
  end

  def log
    Aspera::Log.log
  end

  def get_path(name)
    raise "Missing path: #{name}" unless @paths[name]

    File.join(@top_folder, @paths[name])
  end
end
