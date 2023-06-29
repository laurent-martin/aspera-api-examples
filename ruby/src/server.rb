#!/usr/bin/env ruby
# frozen_string_literal: true

# Example: transfer a file using one of the provided transfer agents
# location of ascp can be specified with env var "ascp"
# temp folder can be specified with env var "tmp"
require 'aspera/fasp/agent_direct'
require 'aspera/fasp/listener'
require 'aspera/fasp/installation'
require 'aspera/log'
require 'aspera/rest'
require 'aspera/rest_errors_aspera'
require 'json'

# set trace level for sample, set to :debug to see complete list of debug information
Log = Aspera::Log
Log.instance.level = :debug
logger = Log.log

unless ARGV.length.eql?(2)
  logger.error { "Wrong number of args: #{ARGV.length}" }
  logger.error { "Usage: #{$PROGRAM_NAME} <config yaml> <file to send>" }
  Process.exit(1)
end

config_yaml = ARGV[0]

all_config = YAML.load_file(config_yaml)
server_conf = all_config['server']

##############################################################
# generic initialization : configuration of FaspManager

# some required files are generated here (keys, certs)
Aspera::Fasp::Installation.instance.sdk_folder = File.join(ENV['CONFIG_TRSDK_DIR_GENERIC'], 'connectors/ruby')
# set path to your copy of ascp binary (else, let the system find)
# Aspera::Fasp::Installation.instance.ascp_path = ENV['ascp'] if ENV.key?('ascp')
# another way is to detect installed products and use one of them
# Aspera::Fasp::Installation.instance.installed_products.each{|p|puts("found: #{p[:name]}")}
# Aspera::Fasp::Installation.instance.use_ascp_from_product('Aspera Connect')

# get Transfer Agent
transfer_agent = Aspera::Fasp::AgentDirect.new

# Note that it would also be possible to start transfers using other agents
# require 'aspera/fasp/connect'
# transfer_agent=Aspera::Fasp::Connect.new
# require 'aspera/fasp/node'
# transfer_agent=Aspera::Fasp::Node.new(Aspera::Rest.new(...))

##############################################################
# Optional : register an event listener

# example of event listener that displays events on stdout
class MyListener < Aspera::Fasp::Listener
  # this is the callback called during transfers, here we only display the received information
  # but it could be used to get detailed error information, check "type" field is "ERROR"
  def event_enhanced(data)
    $stdout.puts(JSON.generate(data))
    $stdout.flush
  end
end

# register the sample listener to display events
transfer_agent.add_listener(MyListener.new)

##############################################################
# download using SSH credentials
server_uri = URI.parse(server_conf['url'])
# manually build transfer spec
transfer_spec = {
  'remote_host' => server_uri.host,
  'ssh_port' => server_uri.port,
  'remote_user' => server_conf['user'],
  'remote_password' => server_conf['pass'],
  'direction' => 'receive',
  'destination_root' => ENV['TMPDIR'],
  'paths' => [{ 'source' => server_conf['download_file'] }]
}
# start transfer in separate thread
# method returns as soon as transfer thread is created
# it des not wait for completion, or even for session startup
transfer_agent.start_transfer(transfer_spec)

# optional: helper method: wait for completion of transfers
# here we started a single transfer session (no multi session parameter)
# get array of status, one for each session (so, a single value array)
# each status is either :success or "error message"
transfer_result = transfer_agent.wait_for_transfers_completion
# get list of errors only
errors = transfer_result.reject { |i| i.eql?(:success) }
# the transfer was not success, as there is at least one error
raise "Error(s) occurred: #{errors.join(',')}" unless errors.empty?
