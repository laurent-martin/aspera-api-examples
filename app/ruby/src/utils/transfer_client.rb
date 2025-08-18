# frozen_string_literal: true

require 'json'
require 'logger'
require 'fileutils'
require 'securerandom'
require 'open3'
require 'grpc'
require 'uri'
require_relative '../transferd_services_pb'

module Utils
  class TransferClient
    ASCP_LOG_FILE = 'aspera-scp-transfer.log'
    DEBUG_HTTP = false
    def initialize(config)
      @config = config
      sdk_url = URI.parse(@config.param('trsdk', 'url'))
      @server_address = sdk_url.host
      @server_port = sdk_url.port
      @transfer_daemon_process = nil
      @transfer_service = nil
      @daemon_name = File.basename(@config.get_path('sdk_daemon'))
      @daemon_log = File.join(@config.log_folder, "#{@daemon_name}.log")
      @logger = config.logger
    end

    def create_config_file(conf_file)
      config_info = {
        'address' => @server_address,
        'port' => @server_port,
        'log_directory' => @config.log_folder,
        'log_level' => @config.param('trsdk', 'level'),
        'fasp_runtime' => {
          'use_embedded' => true,
          'log' => {
            'dir' => @config.log_folder,
            'level' => ascp_level(@config.param('trsdk', 'ascp_level'))
          }
        }
      }
      File.write(conf_file, JSON.pretty_generate(config_info))
    end

    def start_daemon
      file_base = File.join(@config.log_folder, @daemon_name)
      conf_file = "#{file_base}.conf"
      out_file  = "#{file_base}.out"
      err_file  = "#{file_base}.err"

      command = [
        @config.get_path('sdk_daemon'),
        '--config', conf_file
      ]

      @logger.debug("daemon out: #{out_file}")
      @logger.debug("daemon err: #{err_file}")
      @logger.debug("daemon log: #{@daemon_log}")
      @logger.debug("ascp log: #{File.join(@config.log_folder, ASCP_LOG_FILE)}")
      @logger.debug("command: #{command.join(' ')}")

      create_config_file(conf_file)
      @logger.info('Starting daemon...')

      @transfer_daemon_process = Process.spawn(*command,
                                               out: out_file,
                                               err: err_file)
      sleep 2

      _, status = Process.wait2(@transfer_daemon_process, Process::WNOHANG)
      if status
        @logger.error("Daemon not started, exit code=#{status.exitstatus}")
        @logger.error("Check daemon log: #{@daemon_log}")
        raise 'daemon startup failed'
      end

      @logger.info("Daemon started: #{@transfer_daemon_process}")

      return unless @server_port.zero?

      last_line = File.readlines(@daemon_log).last
      log_info = JSON.parse(last_line)
      port_match = log_info['msg'].match(/:(\d+)/)
      raise 'Could not read listening port from log file' unless port_match

      @server_port = port_match[1]
      @logger.info("Allocated server port: #{@server_port}")
    end

    def connect_to_daemon
      channel_address = "#{@server_address}:#{@server_port}"
      @logger.info("Connecting to #{@daemon_name} on: #{channel_address} ...")

      begin
        # GRPC::Core::Channel.new(channel_address, nil, :this_channel_is_insecure)
        @transfer_service = ::Transferd::Api::TransferService::Stub.new(channel_address, :this_channel_is_insecure)
        # Initiate actual connection
        get_info_response = @transfer_service.get_info(::Transferd::Api::InstanceInfoRequest.new)
        @logger.debug("Daemon info: #{get_info_response}")
      rescue GRPC::BadStatus => e
        @logger.error("Failed to connect: #{e}")
        raise 'failed to connect.'
      end

      @logger.info('Connected!')
    end

    def startup
      if @transfer_service.nil?
        start_daemon
        connect_to_daemon
      end
      self
    end

    def shutdown
      if @transfer_daemon_process
        @logger.info('Shutting down daemon...')
        Process.kill('KILL', @transfer_daemon_process)
        Process.wait(@transfer_daemon_process)
        @transfer_daemon_process = nil
      end
      @transfer_service = nil
    end

    def start_transfer(transfer_spec)
      ts_json = JSON.dump(transfer_spec)
      @logger.debug("ts: #{ts_json}")

      transfer_request = ::Transferd::Api::TransferRequest.new(
        transferType: ::Transferd::Api::TransferType::FILE_REGULAR,
        config: ::Transferd::Api::TransferConfig.new,
        transferSpec: ts_json
      )

      transfer_response = @transfer_service.start_transfer(transfer_request)
      throw_on_error(transfer_response.status, transfer_response.error)
      transfer_response.transferId
    end

    def wait_transfer(transfer_id)
      @logger.debug("transfer started with id #{transfer_id}")
      registration_request = ::Transferd::Api::RegistrationRequest.new(
        filters: [::Transferd::Api::RegistrationFilter.new(transferId: [transfer_id])]
      )
      @transfer_service.monitor_transfers(registration_request).each do |transfer_response|
        status = transfer_response.status
        # @logger.info("transfer: #{::Transferd::Api::TransferStatus.constants[status]}")
        @logger.info("transfer: #{status}")
        throw_on_error(status, transfer_response.transferInfo)
        break if status == :COMPLETED
      end
      @logger.info("Transfer #{transfer_id} completed successfully.")
    end

    def start_transfer_and_wait(t_spec)
      startup
      wait_transfer(start_transfer(t_spec))
    end

    def throw_on_error(status, info)
      if status == :FAILED
        raise "transfer failed: #{info.errorDescription}"
      elsif status == :UNKNOWN_STATUS
        raise "unknown transfer id: #{info.errorDescription}"
      end
    end

    private

    def ascp_level(level_string)
      case level_string
      when 'info'  then 0
      when 'debug' then 1
      when 'trace' then 2
      else
        raise "Invalid ascp_level: #{level_string}"
      end
    end
  end
end
