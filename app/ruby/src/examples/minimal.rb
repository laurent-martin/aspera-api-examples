#!/usr/bin/env ruby
# frozen_string_literal: true

# Upload files to an HSTS with SSH credentials, with the Transfer Daemon API only (gRPC).
# Read this sample first: the other samples use the helper class TransferClient, which does the same steps.
# The class Configuration only reads the parameters of the test environment: replace config.param(...) with your values.

require 'json'
require 'tmpdir'
require 'uri'
require 'grpc'
# stub code generated from transferd.proto
require_relative '../transferd_services_pb'
require_relative '../utils/configuration'

# address of the gRPC API, set in the default configuration file of the SDK: etc/transferd.json
DAEMON_ADDRESS = '127.0.0.1:55002'

config = Utils::Configuration.instance

# 1. Start the Transfer Daemon. Without option, transferd reads etc/transferd.json of the SDK.
#    In production, the daemon can also run as a service, started separately.
daemon_out = File.join(Dir.tmpdir, 'transferd_minimal.out')
config.logger.info('Starting daemon')
daemon = Process.spawn(config.get_path('sdk_daemon'), out: daemon_out, err: %i[child out])
begin
  # 2. Connect to the gRPC API of the daemon
  client = Transferd::Api::TransferService::Stub.new(DAEMON_ADDRESS, :this_channel_is_insecure)
  # a first call waits until the daemon listens
  deadline = Time.now + 10
  begin
    client.get_info(Transferd::Api::InstanceInfoRequest.new)
  rescue GRPC::Unavailable
    raise "Failed to connect to daemon: #{DAEMON_ADDRESS}, see: #{daemon_out}" if Time.now > deadline

    sleep(0.2)
    retry
  end
  config.logger.info("Connected to daemon: #{DAEMON_ADDRESS}")

  # 3. Build the transfer spec: upload (send) with SSH credentials
  server_url = URI.parse(config.param('server', 'url'))
  transfer_spec = {
    'direction' => 'send',
    'remote_host' => server_url.host,
    'ssh_port' => server_url.port,
    'remote_user' => config.param('server', 'username'),
    'remote_password' => config.param('server', 'password'),
    'destination_root' => config.param('server', 'folder_upload'),
    # files to transfer: arguments of the command line
    'paths' => ARGV.map { |file| { 'source' => file } }
  }

  # 4. Start the transfer and follow it: the daemon sends an event on each change, until the end of the transfer
  config.logger.info('Uploading files')
  request = Transferd::Api::TransferRequest.new(
    transferType: :FILE_REGULAR,
    config: Transferd::Api::TransferConfig.new,
    transferSpec: JSON.generate(transfer_spec)
  )
  completed = false
  client.start_transfer_with_monitor(request).each do |event|
    config.logger.info("Transfer: #{event.status} #{event.transferInfo&.bytesTransferred.to_i} bytes")
    # the cause of an error is in error, or else in transferInfo
    description = event.error&.description.to_s
    description = event.transferInfo&.errorDescription.to_s if description.empty?
    raise "Transfer failed: #{description.strip}" if %i[FAILED CANCELED].include?(event.status)
    raise "Transfer status unknown: #{description.strip}" if event.status == :UNKNOWN_STATUS

    completed = event.status == :COMPLETED
    break if completed
  end
  # the stream ended before the end of the transfer
  raise 'Transfer monitoring ended before transfer completion' unless completed
ensure
  # 5. Stop the daemon: transferd stops cleanly on SIGINT (Windows: killed)
  config.logger.info('Stopping daemon')
  Process.kill(Gem.win_platform? ? 'KILL' : 'INT', daemon)
  Process.wait(daemon)
end
