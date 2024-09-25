#!/usr/bin/env ruby
# frozen_string_literal: true

# find Faspex API here: https://developer.ibm.com/apis/catalog/?search=faspex
# this example makes use of class Aspera::Rest for REST calls
# alternatively class RestClient of gem rest-client could be used

require_relative 'utils/configuration'

test_env = Configuration.instance

# 1: Faspex 4 API v3
#---------------

# create REST API object
api_v3 = Aspera::Rest.new(
  base_url: test_env.conf('faspex', 'url'),
  auth: {
    type: :basic,
    username: test_env.conf('faspex', 'username'),
    password: test_env.conf('faspex', 'password')
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
  'sources' => [{ 'paths' => test_env.files }]
} }
pkg_created = api_v3.create('send', package_create_params)[:data]
# get transfer specification (normally: only one)
transfer_spec = pkg_created['xfer_sessions'].first
# set paths of files to send
transfer_spec['paths'] = test_env.files.map { |p| { 'source' => p } }
# start transfer (asynchronous)
job_id = test_env.agent.start_transfer(transfer_spec)
Aspera::Log.dump('job_id', job_id)
# wait for all transfer completion (for the example)
result = test_env.agent.wait_for_transfers_completion
#  notify of any transfer error
result.reject { |i| i.eql?(:success) }.each do |e|
  Aspera::Log.log.error { "A transfer error occurred: #{e.message}" }
end

# 3: Faspex 4 API v4 (Requires admin privilege)
#---------------
api_v4 = Aspera::Rest.new(
  base_url: "#{test_env.conf('faspex', 'url')}/api",
  auth: {
    type: :oauth2,
    grant_method: :generic,
    base_url: "#{test_env.conf('faspex', 'url')}/auth/oauth2",
    auth: {
      type: :basic,
      username: test_env.conf('faspex', 'adminuser') || test_env.conf('faspex', 'username'),
      password: test_env.conf('faspex', 'adminpass') || test_env.conf('faspex', 'password')
    },
    grant_type: 'password',
    scope: 'admin'
  }
)

# Use it. Note that Faspex 4 API v4 is totally different from Faspex 4 v3 APIs, see ref in header
test_env.log.debug { Aspera::Log.dump('users', api_v4.read('users')[:data]) }
