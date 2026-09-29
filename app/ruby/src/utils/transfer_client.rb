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
  # Client of the Aspera Transfer Daemon (transferd): start the daemon, start transfers and wait for their end.
  class TransferClient
    ASCP_LOG_FILE = 'aspera-scp-transfer.log'
    DEBUG_HTTP = false
    # default port of transferd if not specified in URL
    TRANSFERD_DEFAULT_PORT = 55_002
    # max wait time for the daemon to log its listening port
    STARTUP_TIMEOUT_SEC = 10
    # max wait time for the connection to the daemon
    CONNECT_TIMEOUT_SEC = 5
    # max wait time for the daemon to stop gracefully
    SHUTDOWN_TIMEOUT_SEC = 10
    # API port in daemon log (text or JSON log format), e.g. `API Server: Listening on 127.0.0.1:55002 ...`
    LISTENING_PORT_REGEX = /API Server: Listening on [^\s"]+:(\d+)/.freeze

    # Create a transfer client.
    # @param config [Configuration] configuration of the samples
    def initialize(config)
      @config = config
      sdk_url = URI.parse(@config.param('trsdk', 'url'))
      @server_address = sdk_url.host
      @server_port = sdk_url.port || TRANSFERD_DEFAULT_PORT
      @transfer_daemon_process = nil
      @transfer_service = nil
      @daemon_name = File.basename(@config.get_path('sdk_daemon'))
      @daemon_log = File.join(@config.log_folder, "#{@daemon_name}.log")
      @logger = config.logger
    end

    # Create the configuration file of the daemon.
    # See: https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
    # @param conf_file [String] path of the configuration file
    # @return [void]
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

    # Start the daemon, with output and logs in the log folder.
    # @return [void]
    def start_daemon
      file_base = File.join(@config.log_folder, @daemon_name)
      conf_file = "#{file_base}.conf"
      out_file  = "#{file_base}.out"
      err_file  = "#{file_base}.err"

      command = [
        @config.get_path('sdk_daemon'),
        '--config', conf_file
      ]

      Configuration.log_dump('Daemon command', command.join(' '))
      Configuration.log_dump('Daemon out', out_file)
      Configuration.log_dump('Daemon err', err_file)
      Configuration.log_dump('Daemon log', @daemon_log)
      Configuration.log_dump('Ascp log', File.join(@config.log_folder, ASCP_LOG_FILE))

      create_config_file(conf_file)
      # the log file may contain lines of previous executions: only read new lines
      log_offset = File.exist?(@daemon_log) ? File.size(@daemon_log) : 0
      @logger.info('Starting daemon')

      @transfer_daemon_process = Process.spawn(*command,
                                               out: out_file,
                                               err: err_file)
      wait_daemon_listening(log_offset)
    end

    # Wait for the daemon to listen, and get the port if dynamically allocated (port 0).
    # The port is read from the daemon log: requires log level `info` or more verbose.
    # @param log_offset [Integer] only read the daemon log after this offset
    # @return [void]
    def wait_daemon_listening(log_offset)
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + STARTUP_TIMEOUT_SEC
      loop do
        _, status = Process.wait2(@transfer_daemon_process, Process::WNOHANG)
        if status
          @transfer_daemon_process = nil
          raise "Daemon exited with code #{status.exitstatus}, see log: #{@daemon_log}"
        end
        # fixed port: readiness is checked on connection
        return unless @server_port.zero?

        port = find_listening_port(log_offset)
        if port
          @server_port = port
          return
        end
        if Process.clock_gettime(Process::CLOCK_MONOTONIC) > deadline
          raise "Listening port not found in daemon log: #{@daemon_log}"
        end

        sleep 0.2
      end
    end

    # Find the API listening port in the daemon log, after the given offset.
    # @param log_offset [Integer] only read the daemon log after this offset
    # @return [Integer, nil] port, or none if not found (yet)
    def find_listening_port(log_offset)
      return nil unless File.exist?(@daemon_log)

      content = File.binread(@daemon_log)
      # log file was truncated
      log_offset = 0 if content.bytesize < log_offset
      match = content.byteslice(log_offset..).match(LISTENING_PORT_REGEX)
      match && match[1].to_i
    end

    # Connect to the daemon.
    # @return [void]
    def connect_to_daemon
      channel_address = "#{@server_address}:#{@server_port}"

      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + CONNECT_TIMEOUT_SEC
      transfer_service = ::Transferd::Api::TransferService::Stub.new(channel_address, :this_channel_is_insecure)
      begin
        # Initiate actual connection (retry until the daemon listens)
        transfer_service.get_info(::Transferd::Api::InstanceInfoRequest.new)
      rescue GRPC::BadStatus => e
        if e.is_a?(GRPC::Unavailable) && Process.clock_gettime(Process::CLOCK_MONOTONIC) < deadline
          sleep 0.2
          retry
        end
        raise "Failed to connect to daemon: #{channel_address}"
      end

      @transfer_service = transfer_service
      @logger.info("Connected to daemon: #{channel_address}")
    end

    # Start the daemon and connect to it, if not already done.
    # @return [TransferClient] this transfer client
    def startup
      if @transfer_service.nil?
        begin
          start_daemon
          connect_to_daemon
        rescue StandardError
          # do not leave the daemon running
          shutdown
          raise
        end
      end
      self
    end

    # Stop the daemon, if it was started: send SIGINT, and kill it if it does not stop in time.
    # @return [void]
    def shutdown
      if @transfer_daemon_process
        @logger.info('Stopping daemon')
        stop_process(@transfer_daemon_process)
        @transfer_daemon_process = nil
      end
      @transfer_service = nil
    end

    # Start a transfer.
    # @param transfer_spec [Hash] transfer spec
    # @return [String] transfer id
    def start_transfer(transfer_spec)
      ts_json = JSON.dump(transfer_spec)
      Configuration.log_dump('Transfer spec', ts_json)

      transfer_request = ::Transferd::Api::TransferRequest.new(
        transferType: ::Transferd::Api::TransferType::FILE_REGULAR,
        config: ::Transferd::Api::TransferConfig.new,
        transferSpec: ts_json
      )

      transfer_response = @transfer_service.start_transfer(transfer_request)
      throw_on_error(transfer_response.status, error_description(transfer_response.error&.description))
      transfer_response.transferId
    end

    # Wait for the end of a transfer, and log its status.
    # @param transfer_id [String] transfer id
    # @return [void]
    def wait_transfer(transfer_id)
      registration_request = ::Transferd::Api::RegistrationRequest.new(
        filters: [::Transferd::Api::RegistrationFilter.new(transferId: [transfer_id])]
      )
      @transfer_service.monitor_transfers(registration_request).each do |transfer_response|
        status = transfer_response.status
        log_status(status, transfer_response.transferInfo&.averageRateKbps.to_i)
        # `error` is empty on session errors: the cause is in session or transfer information
        throw_on_error(status, error_description(transfer_response.error&.description,
                                                 transfer_response.sessionInfo&.errorDesc,
                                                 transfer_response.transferInfo&.errorDescription))
        break if status == :COMPLETED
      end
    end

    # Start the daemon if needed, start a transfer, and wait for its end.
    # @param t_spec [Hash] transfer spec
    # @return [void]
    def start_transfer_and_wait(t_spec)
      startup
      wait_transfer(start_transfer(t_spec))
    end

    # Raise an exception if the transfer status is failed or unknown.
    # @param status [Symbol] transfer status
    # @param description [String] error description
    # @return [void]
    def throw_on_error(status, description)
      if status == :FAILED
        raise "Transfer failed: #{description}"
      elsif status == :UNKNOWN_STATUS
        raise "Unknown transfer id: #{description}"
      end
    end

    # Log the transfer status, and the rate when running.
    # @param status [Symbol] transfer status
    # @param average_rate_kbps [Integer] average rate in kilobits per second
    # @return [void]
    def log_status(status, average_rate_kbps)
      rate = status == :RUNNING ? format(' %.1f Mbps', average_rate_kbps / 1000.0) : ''
      @logger.info("Transfer: #{status}#{rate}")
    end

    # Get the first non-empty error description.
    # @param texts [Array<String, nil>] error descriptions
    # @return [String] error description, or `unknown error`
    def error_description(*texts)
      texts.map { |text| text.to_s.strip }.find { |text| !text.empty? } || 'unknown error'
    end

    private

    # Stop the daemon: send SIGINT, and kill it if it does not stop in time.
    # transferd stops cleanly on SIGINT (not on SIGTERM).
    # Windows has no SIGINT for child processes: the process is terminated.
    # @param pid [Integer] process id of the daemon
    # @return [void]
    def stop_process(pid)
      Process.kill(Gem.win_platform? ? 'KILL' : 'INT', pid)
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + SHUTDOWN_TIMEOUT_SEC
      while Process.clock_gettime(Process::CLOCK_MONOTONIC) < deadline
        return if Process.wait(pid, Process::WNOHANG)

        sleep 0.1
      end
      @logger.warn('Daemon did not stop, killing it')
      Process.kill('KILL', pid)
      Process.wait(pid)
    end

    # Convert the log level of ascp from name to number.
    # @param level_string [String] `info`, `debug` or `trace`
    # @return [Integer] 0, 1 or 2
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
