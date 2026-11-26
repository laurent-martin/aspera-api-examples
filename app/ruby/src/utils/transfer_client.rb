# frozen_string_literal: true

require 'json'
require 'logger'
require 'fileutils'
require 'securerandom'
require 'tmpdir'
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
    # max wait time for the daemon to write its port file
    STARTUP_TIMEOUT_SEC = 10
    # max wait time for the connection to the daemon
    CONNECT_TIMEOUT_SEC = 5
    # max wait time for the daemon to stop gracefully
    SHUTDOWN_TIMEOUT_SEC = 10
    # extension of the port file, written in `runtime_dir` with port 0: `transferd.<port>.optport`
    PORT_FILE_EXTENSION = '.optport'

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
      # folder of the configuration, output and logs of the daemon: a new one for each start
      @daemon_folder = nil
      @daemon_log = nil
      # `runtime_dir` of the daemon, where it writes its port file: only with port 0
      @runtime_dir = nil
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
        'log_directory' => @daemon_folder,
        'log_level' => @config.param('trsdk', 'level'),
        'fasp_runtime' => {
          'use_embedded' => true,
          'log' => {
            'dir' => @daemon_folder,
            'level' => ascp_level(@config.param('trsdk', 'ascp_level'))
          }
        }
      }
      config_info['runtime_dir'] = @runtime_dir unless @runtime_dir.nil?
      File.write(conf_file, JSON.pretty_generate(config_info))
    end

    # Start the daemon, with its configuration, output and logs in a new folder of the log folder.
    # @return [void]
    def start_daemon
      # samples run at the same time do not share files
      @daemon_folder = Dir.mktmpdir("#{@daemon_name}.", @config.log_folder)
      file_base = File.join(@daemon_folder, @daemon_name)
      conf_file = "#{file_base}.conf"
      out_file  = "#{file_base}.out"
      err_file  = "#{file_base}.err"
      @daemon_log = "#{file_base}.log"
      if @server_port.zero?
        # the daemon writes its port file in this folder: of this daemon only, readable only by the user
        @runtime_dir = File.join(@daemon_folder, 'run')
        Dir.mkdir(@runtime_dir, 0o700)
      end

      command = [@config.get_path('sdk_daemon'), '--config', conf_file]

      Configuration.log_dump('Daemon command', command.join(' '))
      Configuration.log_dump('Daemon out', out_file)
      Configuration.log_dump('Daemon err', err_file)
      Configuration.log_dump('Daemon log', @daemon_log)
      Configuration.log_dump('Ascp log', File.join(@daemon_folder, ASCP_LOG_FILE))

      create_config_file(conf_file)
      @logger.info('Starting daemon')

      @transfer_daemon_process = Process.spawn(*command, out: out_file, err: err_file)
      wait_daemon_listening
    end

    # Wait for the daemon to listen, and get the port if dynamically allocated (port 0).
    # With port 0, the daemon writes its port in a file of its `runtime_dir` once it listens.
    # This requires transferd 1.1.7 or later.
    # @return [void]
    def wait_daemon_listening
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + STARTUP_TIMEOUT_SEC
      loop do
        _, status = Process.wait2(@transfer_daemon_process, Process::WNOHANG)
        if status
          @transfer_daemon_process = nil
          raise "Daemon exited with code #{status.exitstatus}, see log: #{@daemon_log}"
        end
        # fixed port: readiness is checked on connection
        return unless @server_port.zero?

        port = read_port_file(@runtime_dir)
        if port
          @server_port = port
          return
        end
        if Process.clock_gettime(Process::CLOCK_MONOTONIC) > deadline
          raise "Port file not found in #{@runtime_dir}: transferd 1.1.7 or later is required"
        end

        sleep 0.2
      end
    end

    # Read the port of the daemon in its port file `transferd.<port>.optport`, in its `runtime_dir`.
    # The daemon creates the file, then writes the port: an empty file is not ready yet.
    # @param runtime_dir [String] `runtime_dir` of the daemon
    # @return [Integer, nil] port, or none if not written (yet)
    def read_port_file(runtime_dir)
      port_files = Dir.children(runtime_dir).select { |name| name.end_with?(PORT_FILE_EXTENSION) }
                      .map { |name| File.join(runtime_dir, name) }
      return nil if port_files.empty?
      raise "Several port files in #{runtime_dir}" if port_files.length > 1

      content = File.read(port_files.first)
      return nil if content.empty?
      raise "No port in file #{port_files.first}" unless content.match?(/\A[0-9]+\z/)

      content.to_i
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
    # Then delete its `runtime_dir`: a killed daemon does not delete its port file.
    # @return [void]
    def shutdown
      if @transfer_daemon_process
        @logger.info('Stopping daemon')
        stop_process(@transfer_daemon_process)
        @transfer_daemon_process = nil
      end
      @transfer_service = nil
      FileUtils.rm_rf(@runtime_dir) unless @runtime_dir.nil?
      @runtime_dir = nil
    end

    # Start the daemon if needed, start a transfer, and wait for its end.
    # @param transfer_spec [Hash] transfer spec
    # @return [void]
    def start_transfer_and_wait(transfer_spec)
      startup
      ts_json = JSON.dump(transfer_spec)
      Configuration.log_dump('Transfer spec', ts_json)
      transfer_request = ::Transferd::Api::TransferRequest.new(
        transferType: ::Transferd::Api::TransferType::FILE_REGULAR,
        config: ::Transferd::Api::TransferConfig.new,
        transferSpec: ts_json
      )
      # start the transfer: the daemon sends an event on each change, until the end of the transfer
      # leaving the block closes the call: stop monitoring, if the stream is still open
      completed = false
      @transfer_service.start_transfer_with_monitor(transfer_request).each do |event|
        status = event.status
        log_status(status, event.transferInfo&.averageRateKbps.to_i)
        # `error` is empty on session errors: the cause is in session or transfer information
        throw_on_error(status, error_description(event.error&.description,
                                                 event.sessionInfo&.errorDesc,
                                                 event.transferInfo&.errorDescription))
        next unless status == :COMPLETED

        completed = true
        break
      end
      raise 'Transfer monitoring ended before transfer completion' unless completed
    end

    # Raise an exception if the transfer status is failed, canceled or unknown.
    # @param status [Symbol] transfer status
    # @param description [String] error description
    # @return [void]
    def throw_on_error(status, description)
      if %i[FAILED CANCELED].include?(status)
        raise "Transfer failed: #{description}"
      elsif status == :UNKNOWN_STATUS
        raise "Transfer status unknown: #{description}"
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

    # Get the transfer spec from the response of Node API `upload_setup` or `download_setup`,
    # and raise an exception on error.
    #
    # The Node API may return an error in the response data, or an empty object, instead of an HTTP error.
    # @param response_data [Hash, nil] response data, for a single transfer request
    # @return [Hash] transfer spec
    def self.transfer_spec_from_setup(response_data)
      response_data ||= {}
      result = (response_data['transfer_specs'] || []).first || {}
      error = response_data['error'] || result['error']
      raise "Node API error: #{error['user_message']}" if error
      raise 'No transfer spec in Node API response' unless result['transfer_spec']

      result['transfer_spec']
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
