#!/usr/bin/env ruby
# frozen_string_literal: true

# find Faspex API here: https://developer.ibm.com/apis/catalog/?search=faspex
# this example makes use of class Aspera::Rest for REST calls, alternatively class RestClient of gem rest-client could be used
# this example makes use of class Aspera::Fasp::AgentDirect for transfers, alternatively the official "Transfer SDK" could be used
# Aspera SDK can be downloaded with: `ascli conf ascp install` , it installs in $HOME/.aspera/ascli/sdk
require 'aspera/rest'
require 'aspera/oauth'
require 'aspera/log'
require 'aspera/fasp/agent_direct'

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

all_config = YAML.load_file(config_yaml)
faspex_conf = all_config['faspex']

Aspera::Log.dump(:config, faspex_conf)

# 1: Faspex 4 API v3
#---------------

# create REST API object
api_v3 = Aspera::Rest.new(
  base_url: faspex_conf['url'],
  auth: {
    type: :basic,
    username: faspex_conf['user'],
    password: faspex_conf['pass']
  }
)

# very simple api call
api_v3.read('me')

# 2: send a package
#---------------

# package creation parameters
package_create_params = { 'delivery' => {
  'title' => 'test package',
  'recipients' => ['aspera.user1@gmail.com'],
  'sources' => [{ 'paths' => files_to_send }]
} }
pkg_created = api_v3.create('send', package_create_params)[:data]
# get transfer specification (normally: only one)
transfer_spec = pkg_created['xfer_sessions'].first
# set paths of files to send
transfer_spec['paths'] = files_to_send.map { |p| { 'source' => p } }
# start transfer (asynchronous)
job_id = transfer_agent.start_transfer(transfer_spec)
Aspera::Log.dump('job_id', job_id)
# wait for all transfer completion (for the example)
result = transfer_agent.wait_for_transfers_completion
#  notify of any transfer error
result.reject { |i| i.eql?(:success) }.each do |e|
  Aspera::Log.log.error { "A transfer error occurred: #{e.message}" }
end

# 3: Faspex 4 API v4 (Requires admin privilege)
#---------------
api_v4 = Aspera::Rest.new(
  base_url: "#{faspex_conf['url']}/api",
  auth: {
    type: :oauth2,
    base_url: "#{faspex_conf['url']}/auth/oauth2",
    auth: {
      type: :basic,
      username: faspex_conf['adminuser'] || faspex_conf['user'],
      password: faspex_conf['adminpass'] || faspex_conf['pass']
    },
    grant_method: :generic,
    generic: { grant_type: 'password' },
    scope: 'admin'
  }
)

# Use it. Note that Faspex 4 API v4 is totally different from Faspex 4 v3 APIs, see ref in header
Aspera::Log.dump('users', api_v4.read('users')[:data])
