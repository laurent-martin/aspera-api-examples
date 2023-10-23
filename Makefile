DIR_TOP=$(shell pwd -P)/
include $(DIR_TOP)common.make
CONFIG_TMPL=config/config.tmpl
all: .is_setup
clean:
	cd js && make clean
	cd python && make clean
	cd java && make clean
	cd web && make clean
	rm -f .is_setup $(CONFIG_TRSDK_CONFIG)
	rm -fr $(TMP_GENERATED)
# transfer SDK is installed
.is_setup: $(MAIN_CONFIG) $(CONFIG_TRSDK_DIR_ARCH)asperatransferd $(CONFIG_TRSDK_CONFIG)
	touch $@
# start transfer SDK daemon
startdaemon: $(CONFIG_TRSDK_CONFIG)
	$(CONFIG_TRSDK_DIR_ARCH)asperatransferd -c $(CONFIG_TRSDK_CONFIG)
stopdaemon:
	-killall asperatransferd
# generate transfer SDK config file, need utility `jq`
# see https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
$(CONFIG_TRSDK_CONFIG): $(MAIN_CONFIG) $(DIR_TOP)config/sdkconf.tmpl
	jq \
'.address = "'$$(sed -n 's|.*trsdk_url.*//\([^:]*\):.*|\1|p' < $(MAIN_CONFIG))'"'\
' | .port = '$$(sed -n 's|.*trsdk_url.*:\([0-9]*\).*|\1|p' < $(MAIN_CONFIG))''\
' | .fasp_runtime.user_defined.bin = "'$(CONFIG_TRSDK_DIR_ARCH)'"'\
' | .fasp_runtime.user_defined.etc = "'$(CONFIG_TRSDK_DIR_GENERIC)'"'\
' | .fasp_runtime.log.dir = "'$(TMPDIR)'"'\
' | .fasp_runtime.log.level = 0'\
' | .log_directory = "'$(TMPDIR)'"'\
' | .log_level = "debug"'\
' | del(.api_time_settings, .tls, .workers, .authentication, .fasp_management, .fasp_runtime.force_version, .fasp_runtime.extra_config)'\
 $(DIR_TOP)config/sdkconf.tmpl > $@
# download transfer SDK
$(CONFIG_TRSDK_ROOT)transfer_sdk.zip:
	mkdir -p $(CONFIG_TRSDK_ROOT)
	curl -L https://ibm.biz/aspera_transfer_sdk -o $(CONFIG_TRSDK_ROOT)transfer_sdk.zip
# extract transfer SDK
$(CONFIG_TRSDK_DIR_ARCH)asperatransferd: $(CONFIG_TRSDK_ROOT)transfer_sdk.zip
	@echo $(CONFIG_TRSDK_DIR_ARCH)
	unzip -d $(CONFIG_TRSDK_ROOT) $(CONFIG_TRSDK_ROOT)transfer_sdk.zip
	rm -f $(CONFIG_TRSDK_DIR_ARCH)ascp4
	cp $(CONFIG_TRSDK_DIR_ARCH)ascp $(CONFIG_TRSDK_DIR_ARCH)ascp4
	echo '<product><name>IBM Aspera SDK</name><version>1.1.1.52</version></product>' > $(CONFIG_TRSDK_DIR_ARCH)product-info.mf
	cp $(CONFIG_TRSDK_DIR_GENERIC)aspera-license $(CONFIG_TRSDK_DIR_ARCH)
	touch $@
# create template from actual private config file
template: $(CONFIG_TMPL)
$(CONFIG_TMPL): $(MAIN_CONFIG)
	sed '/^#/ d;s/^\(  [^:]*:\).*/\1 your_value_here/' < $(MAIN_CONFIG) > $(CONFIG_TMPL)
$(MAIN_CONFIG):
	@echo "Create a file: $@ from $(CONFIG_TMPL), refer to README.md"
	@echo "cp $(CONFIG_TMPL) $(MAIN_CONFIG)"
	@echo "vi $(MAIN_CONFIG)"
	@exit 1
tests:  .is_setup
	cd js && make
	cd python && make
	cd java && make
	cd web && make test
