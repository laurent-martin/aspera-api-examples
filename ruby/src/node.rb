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
Aspera::SecretHider.log_secrets = true

unless ARGV.length.eql?(2)
  logger.error { "Wrong number of args: #{ARGV.length}" }
  logger.error { "Usage: #{$PROGRAM_NAME} <config yaml> <file to send>" }
  Process.exit(1)
end

config_yaml = ARGV[0]
files_to_send = [ARGV[1]]

all_config = YAML.load_file(config_yaml)
node_conf = all_config['node']
destination_folder = all_config['server']['upload_folder']

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

# register aspera REST call error handlers
Aspera::RestErrorsAspera.register_handlers

##############################################################
# Upload with node authorization

# create rest client for Node API on a public demo system, using public demo credentials
node_api = Aspera::Rest.new(
  base_url: node_conf['url'],
  auth: {
    type: :basic,
    username: node_conf['user'],
    password: node_conf['pass']
  }
)
# request transfer authorization to node for a single transfer (This is a node api v3 call)
send_result = node_api.create(
  'files/upload_setup',
  { transfer_requests: [{ transfer_request: { paths: [{ destination: destination_folder }] } }] }
)[:data]
# we normally have only one transfer spec in list, so just get the first transfer_spec
transfer_spec = send_result['transfer_specs'].first['transfer_spec']
# add list of files to upload
transfer_spec['paths'] = files_to_send.map { |p| { 'source' => p } }
# set authentication type to "token" (will trigger use of bypass SSH key)
# transfer_spec['authentication'] = 'token'
# start transfer
transfer_agent.start_transfer(transfer_spec)
# optional: wait for transfer completion helper function to get events
transfer_result = transfer_agent.wait_for_transfers_completion
errors = transfer_result.reject { |i| i.eql?(:success) }
# the transfer was not success, as there is at least one error
raise "Error(s) occurred: #{errors.join(',')}" unless errors.empty?
