#!/usr/bin/env ruby
# frozen_string_literal: true

# find Faspex API here: https://developer.ibm.com/apis/catalog/?search=faspex
# this example makes use of class Aspera::Rest for REST calls, alternatively class RestClient of gem rest-client could be used

$LOAD_PATH.unshift(File.join(File.dirname(__FILE__), '..', 'lib'))
require 'test_environment'

Aspera::Log.instance.level = :debug
all_config = TestEnvironment.instance.config
faspex_conf = all_config['faspex']

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
  'sources' => [{ 'paths' => TestEnvironment.instance.files }]
} }
pkg_created = api_v3.create('send', package_create_params)[:data]
# get transfer specification (normally: only one)
transfer_spec = pkg_created['xfer_sessions'].first
# set paths of files to send
transfer_spec['paths'] = TestEnvironment.instance.files.map { |p| { 'source' => p } }
# start transfer (asynchronous)
job_id = TestEnvironment.instance.agent.start_transfer(transfer_spec)
Aspera::Log.dump('job_id', job_id)
# wait for all transfer completion (for the example)
result = TestEnvironment.instance.agent.wait_for_transfers_completion
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
