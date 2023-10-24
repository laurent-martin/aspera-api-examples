DIR_TOP=$(shell pwd -P)/
include $(DIR_TOP)common.make
CONFIG_TMPL=$(DIR_TOP)config/config.tmpl
CONFIG_FILE=$(DIR_TOP)$(shell sed -n -e 's/^mainconfig: //p' < $(GLOBAL_PATHS))
GENERATED_ROOT=$(DIR_TOP)$(shell sed -n -e 's/^tmpgen: //p' < $(GLOBAL_PATHS))/
TRSDK_ROOT=$(DIR_TOP)$(shell sed -n -e 's/^sdk_root: //p' < $(GLOBAL_PATHS))/
TRSDK_CONFIG=$(DIR_TOP)$(shell sed -n -e 's/^sdk_conf: //p' < $(GLOBAL_PATHS))
TRSDK_ARCH=$(TRSDK_ROOT)$(shell sed -n -e 's/^ *system_type: //p' < $(CONFIG_FILE))/
TRSDK_ZIP=$(TRSDK_ROOT)transfer_sdk.zip
all: $(IS_OK)
clean:
	cd js && make clean
	cd python && make clean
	cd java && make clean
	cd web && make clean
	rm -f $(IS_OK) $(TRSDK_CONFIG)
	rm -fr $(GENERATED_ROOT)
# ensure that SDK is installed and config file are here
$(IS_OK): $(CONFIG_FILE) $(TRSDK_ARCH)asperatransferd $(TRSDK_CONFIG)
	touch $@
# start transfer SDK daemon
startdaemon: $(TRSDK_CONFIG)
	$(TRSDK_ARCH)asperatransferd -c $(TRSDK_CONFIG)
stopdaemon:
	-killall asperatransferd
# generate transfer SDK config file, need utility `jq`
# see https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
$(TRSDK_CONFIG): $(CONFIG_FILE) $(DIR_TOP)config/sdkconf.tmpl
	jq \
'.address = "'$$(sed -n 's|.*trsdk_url.*//\([^:]*\):.*|\1|p' < $(CONFIG_FILE))'"'\
' | .port = '$$(sed -n 's|.*trsdk_url.*:\([0-9]*\).*|\1|p' < $(CONFIG_FILE))''\
' | .fasp_runtime.user_defined.bin = "'$(TRSDK_ARCH)'"'\
' | .fasp_runtime.user_defined.etc = "'$(GLOBAL_TRSDK_NOARCH)'"'\
' | .fasp_runtime.log.dir = "'$(TMPDIR)'"'\
' | .fasp_runtime.log.level = 0'\
' | .log_directory = "'$(TMPDIR)'"'\
' | .log_level = "debug"'\
' | del(.api_time_settings, .tls, .workers, .authentication, .fasp_management, .fasp_runtime.force_version, .fasp_runtime.extra_config)'\
 $(DIR_TOP)config/sdkconf.tmpl > $@
# download transfer SDK
$(TRSDK_ZIP):
	mkdir -p $(TRSDK_ROOT)
	curl -L https://ibm.biz/aspera_transfer_sdk -o $(TRSDK_ZIP)
# extract transfer SDK
# Note: create the link: etc because the SDK configuration does not use its "etc" configuration.
$(TRSDK_ARCH)asperatransferd: $(TRSDK_ZIP)
	@echo $(TRSDK_ARCH)
	unzip -d $(TRSDK_ROOT) $(TRSDK_ZIP)
	echo '<product><name>IBM Aspera SDK</name><version>1.1.1.52</version></product>' > $(TRSDK_ARCH)product-info.mf
	ln -s noarch $(TRSDK_ROOT)etc
	touch $@
# create template from actual private config file
template: $(CONFIG_TMPL)
$(CONFIG_TMPL): $(CONFIG_FILE)
	sed '/^#/ d;s/^\(  [^:]*:\).*/\1 your_value_here/' < $(CONFIG_FILE) > $(CONFIG_TMPL)
$(CONFIG_FILE):
	@echo "Create a file: $@ from $(CONFIG_TMPL), refer to README.md"
	@echo "cp $(CONFIG_TMPL) $(CONFIG_FILE)"
	@echo "vi $(CONFIG_FILE)"
	@exit 1
tests:  $(IS_OK)
	cd js && make
	cd python && make
	cd java && make
	cd web && make test
