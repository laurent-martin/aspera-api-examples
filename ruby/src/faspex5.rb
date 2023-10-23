#!/usr/bin/env ruby
# frozen_string_literal: true

# find Faspex API here: https://developer.ibm.com/apis/catalog/?search=faspex
# this example makes use of class Aspera::Rest for REST calls
# alternatively class RestClient of gem rest-client could be used

$LOAD_PATH.unshift(File.join(File.dirname(__FILE__), '..', 'lib'))
require 'test_environment'

Aspera::Log.instance.level = :debug
all_config = TestEnvironment.instance.config
f5_conf = all_config['faspex5']
logger = Aspera::Log.log

# 1: Faspex 5 API v5
#---------------

# create REST API object
api_v5 = Aspera::Rest.new(
  {
    base_url: "#{f5_conf['url']}/api/v5",
    auth: {
      type: :oauth2,
      base_url: "#{f5_conf['url']}/auth",
      grant_method: :jwt,
      crtype: :jwt,
      client_id: f5_conf['client_id'],
      jwt: {
        payload: {
          iss: f5_conf['client_id'],    # issuer
          aud: f5_conf['client_id'],    # audience
          sub: "user:#{f5_conf['username']}" # subject
        },
        private_key_obj: OpenSSL::PKey::RSA.new(File.read(File.expand_path(f5_conf['private_key'])),
                                                f5_conf['passphrase']),
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
  'recipients': [{ 'name': f5_conf['username'] }]
}
package = api_v5.create('packages', package_create_params)[:data]
ts_paths = { 'paths' => TestEnvironment.instance.files.map { |p| { 'source' => p } } }
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
job_id = TestEnvironment.instance.agent.start_transfer(transfer_spec)
Aspera::Log.dump('job_id', job_id)
# wait for all transfer completion (for the example)
result = TestEnvironment.instance.agent.wait_for_transfers_completion
#  notify of any transfer error
result.reject { |i| i.eql?(:success) }.each do |e|
  logger.error { "A transfer error occurred: #{e.message}" }
end
