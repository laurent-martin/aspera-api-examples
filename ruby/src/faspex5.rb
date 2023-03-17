#!/usr/bin/env ruby
# frozen_string_literal: true

# find Faspex API here: https://developer.ibm.com/apis/catalog/?search=faspex
# this example makes use of class Aspera::Rest for REST calls
# alternatively class RestClient of gem rest-client could be used
# this example makes use of class Aspera::Fasp::AgentTrsdk for transfers
require 'aspera/rest'
require 'aspera/log'
require 'aspera/fasp/agent_trsdk'
require 'yaml'
require 'openssl'

tmpdir = ENV['tmp'] || Dir.tmpdir || '.'

# Set high log level for the example, decrease to :warn usually
Aspera::Log.instance.level = :debug

print(ENV['CONFIG_TRSDK_DIR_GENERIC'])

Aspera::Fasp::Installation.instance.sdk_folder = File.join(ENV['CONFIG_TRSDK_DIR_GENERIC'], 'connectors/ruby')

# Set folder where SDK is installed (mandatory)
# (if ascp is not there, the lib will try to find in usual locations)
# (if data files are not there, they will be created)
# Aspera::Fasp::Installation.instance.folder = tmpdir

unless ARGV.length.eql?(2)
  Aspera::Log.log.error { "Wrong number of args: #{ARGV.length}" }
  Aspera::Log.log.error { "Usage: #{$PROGRAM_NAME} <config yaml> <file to send>" }
  Process.exit(1)
end

config_yaml = ARGV[0]
file_to_send = ARGV[1]

# assume dev system with self signed cert
Aspera::Rest.session_cb = ->(http) { http.verify_mode = OpenSSL::SSL::VERIFY_NONE }

config = YAML.load_file(config_yaml)['faspex5']

Aspera::SecretHider.log_secrets = true
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
Aspera::Log.log.debug(api_v5.read('version'))

# 2: send a package
#---------------

# package creation parameters
package_create_params = {
  "title": 'test title',
  "recipients": [{ "name": config['username'] }]
}
package = api_v5.create('packages', package_create_params)[:data]
files_to_transfer = { paths: [{ source: file_to_send }] }
transfer_spec = api_v5.call(
  operation: 'POST',
  subpath: "packages/#{package['id']}/transfer_spec/upload",
  headers: { 'Accept' => 'application/json' },
  url_params: { transfer_type: 'connect' },
  json_params: files_to_transfer
)[:data]
transfer_spec.delete('authentication')
transfer_spec.merge!(files_to_transfer)
Aspera::Log.dump('transfer_spec', transfer_spec)
# get local agent (ascp), disable ascp output on stdout to not mix with JSON events
transfer_client = Aspera::Fasp::AgentTrsdk.new({})
# start transfer (asynchronous)
job_id = transfer_client.start_transfer(transfer_spec)
Aspera::Log.dump('job_id', job_id)
# wait for all transfer completion (for the example)
result = transfer_client.wait_for_transfers_completion
#  notify of any transfer error
result.reject { |i| i.eql?(:success) }.each do |e|
  Aspera::Log.log.error { "A transfer error occurred: #{e.message}" }
end
