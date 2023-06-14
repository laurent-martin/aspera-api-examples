#!/usr/bin/env ruby
# frozen_string_literal: true

# find Faspex API here: https://developer.ibm.com/apis/catalog/?search=faspex
# this example makes use of class Aspera::Rest for REST calls
# alternatively class RestClient of gem rest-client could be used
# this example makes use of class Aspera::Fasp::AgentTrsdk for transfers
require 'aspera/fasp/agent_direct'
require 'aspera/rest'
require 'aspera/log'
require 'yaml'
require 'openssl'

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

# Set folder where SDK is installed (mandatory)
# (if ascp is not there, the lib will try to find in usual locations)
# (if data files are not there, they will be created)
Aspera::Fasp::Installation.instance.sdk_folder = File.join(ENV['CONFIG_TRSDK_DIR_GENERIC'], 'connectors/ruby')

# get Transfer Agent
transfer_agent = Aspera::Fasp::AgentDirect.new
# transfer_agent = Aspera::Fasp::AgentTrsdk.new({})

config_yaml = ARGV[0]
files_to_send = [ARGV[1]]

# ignore self signed cert
Aspera::Rest.session_cb = ->(http) { http.verify_mode = OpenSSL::SSL::VERIFY_NONE }

config = YAML.load_file(config_yaml)['faspex5']

Aspera::Log.dump(:config, config)

# 1: Faspex 5 API v5
#---------------

# create REST API object
api_v5 = Aspera::Rest.new(
  {
    base_url: "#{config['url']}/api/v5",
    auth: {
      type: :oauth2,
      base_url: "#{config['url']}/auth",
      grant_method: :jwt,
      crtype: :jwt,
      client_id: config['client_id'],
      jwt: {
        payload: {
          iss: config['client_id'],    # issuer
          aud: config['client_id'],    # audience
          sub: "user:#{config['username']}" # subject
        },
        private_key_obj: OpenSSL::PKey::RSA.new(File.read(File.expand_path(config['private_key'])),
                                                config['passphrase']),
        headers: { typ: 'JWT' }
      }
    }
  }
)

# very simple api call
logger.debug(api_v5.read('version'))

# 2: send a package
#---------------

# package creation parameters
package_create_params = {
  'title': 'test title',
  'recipients': [{ 'name': config['username'] }]
}
package = api_v5.create('packages', package_create_params)[:data]
ts_paths = { 'paths' => files_to_send.map { |p| { 'source' => p } } }
transfer_spec = api_v5.call(
  operation: 'POST',
  subpath: "packages/#{package['id']}/transfer_spec/upload",
  headers: { 'Accept' => 'application/json' },
  url_params: { transfer_type: 'connect' },
  json_params: ts_paths
)[:data]
transfer_spec.delete('authentication')
transfer_spec.merge!(ts_paths)

Aspera::Log.dump('transfer_spec', transfer_spec)
# start transfer (asynchronous)
job_id = transfer_agent.start_transfer(transfer_spec)
Aspera::Log.dump('job_id', job_id)
# wait for all transfer completion (for the example)
result = transfer_agent.wait_for_transfers_completion
#  notify of any transfer error
result.reject { |i| i.eql?(:success) }.each do |e|
  logger.error { "A transfer error occurred: #{e.message}" }
end
