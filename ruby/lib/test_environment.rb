# frozen_string_literal: true

require 'yaml'
require 'singleton'
require 'json'
require 'tmpdir'
require 'aspera/log'
require 'aspera/fasp/agent_direct'
require 'aspera/fasp/listener'
require 'aspera/fasp/installation'
require 'aspera/rest'
require 'aspera/rest_errors_aspera'

Aspera::Log.instance.level = :debug
Aspera::SecretHider.log_secrets = true
# register aspera REST call error handlers
Aspera::RestErrorsAspera.register_handlers
# ignore self signed cert
Aspera::Rest.session_cb = ->(http) { http.verify_mode = OpenSSL::SSL::VERIFY_NONE }

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



# example of event listener that displays events on stdout
class MyListener < Aspera::Fasp::Listener
  # this is the callback called during transfers, here we only display the received information
  # but it could be used to get detailed error information, check "type" field is "ERROR"
  def event_enhanced(data)
    $stdout.puts(JSON.generate(data))
    $stdout.flush
  end
end

# setup test env
class TestEnvironment
  include Singleton
  attr_reader :top_folder, :config, :files, :agent

  def initialize
    @top_folder = File.join(File.dirname(__FILE__), '..', '..')
    @paths = YAML.load_file(File.join(@top_folder, 'config/paths.yaml'))
    @config = YAML.load_file(get_path('main_config'))
    Aspera::Log.dump(:config, @config)
    raise "Missing config file: #{get_path('main_config')}" unless @config['misc']

    # some required files are generated here (keys, certs)
    Aspera::Fasp::Installation.instance.sdk_folder = File.join(get_path('trsdk_noarch'), 'connectors/ruby')
    # get Transfer Agent
    @agent = Aspera::Fasp::AgentDirect.new
    # register the sample listener to display events
    @agent.add_listener(MyListener.new)
    unless ARGV.length.eql?(1)
      Aspera::Log.log.error { "Wrong number of args: #{ARGV.length}" }
      Aspera::Log.log.error { "Usage: #{$PROGRAM_NAME} <file to send>" }
      Process.exit(1)
    end
    @files = [ARGV[0]]
  end

  def get_path(name)
    File.join(@top_folder, @paths[name])
  end
end
