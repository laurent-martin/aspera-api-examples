DIR_TOP=$(shell pwd -P)/
include $(DIR_TOP)common.make
CONFIG_TMPL=config/config.tmpl
TRANSFER_SDK_ZIP=$(GLOBAL_TRSDK_ROOT)transfer_sdk.zip
all: .is_setup
clean:
	cd js && make clean
	cd python && make clean
	cd java && make clean
	cd web && make clean
	rm -f .is_setup $(GLOBAL_TRSDK_CONFIG)
	rm -fr $(GLOBAL_GENERATED)
# transfer SDK is installed
.is_setup: $(GLOBAL_CONFIG) $(GLOBAL_TRSDK_ARCH)asperatransferd $(GLOBAL_TRSDK_CONFIG)
	touch $@
# start transfer SDK daemon
startdaemon: $(GLOBAL_TRSDK_CONFIG)
	$(GLOBAL_TRSDK_ARCH)asperatransferd -c $(GLOBAL_TRSDK_CONFIG)
stopdaemon:
	-killall asperatransferd
# generate transfer SDK config file, need utility `jq`
# see https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
$(GLOBAL_TRSDK_CONFIG): $(GLOBAL_CONFIG) $(DIR_TOP)config/sdkconf.tmpl
	jq \
'.address = "'$$(sed -n 's|.*trsdk_url.*//\([^:]*\):.*|\1|p' < $(GLOBAL_CONFIG))'"'\
' | .port = '$$(sed -n 's|.*trsdk_url.*:\([0-9]*\).*|\1|p' < $(GLOBAL_CONFIG))''\
' | .fasp_runtime.user_defined.bin = "'$(GLOBAL_TRSDK_ARCH)'"'\
' | .fasp_runtime.user_defined.etc = "'$(GLOBAL_TRSDK_NOARCH)'"'\
' | .fasp_runtime.log.dir = "'$(TMPDIR)'"'\
' | .fasp_runtime.log.level = 0'\
' | .log_directory = "'$(TMPDIR)'"'\
' | .log_level = "debug"'\
' | del(.api_time_settings, .tls, .workers, .authentication, .fasp_management, .fasp_runtime.force_version, .fasp_runtime.extra_config)'\
 $(DIR_TOP)config/sdkconf.tmpl > $@
# download transfer SDK
$(TRANSFER_SDK_ZIP):
	mkdir -p $(GLOBAL_TRSDK_ROOT)
	curl -L https://ibm.biz/aspera_transfer_sdk -o $(TRANSFER_SDK_ZIP)
# extract transfer SDK
$(GLOBAL_TRSDK_ARCH)asperatransferd: $(TRANSFER_SDK_ZIP)
	@echo $(GLOBAL_TRSDK_ARCH)
	unzip -d $(GLOBAL_TRSDK_ROOT) $(TRANSFER_SDK_ZIP)
	rm -f $(GLOBAL_TRSDK_ARCH)ascp4
	cp $(GLOBAL_TRSDK_ARCH)ascp $(GLOBAL_TRSDK_ARCH)ascp4
	echo '<product><name>IBM Aspera SDK</name><version>1.1.1.52</version></product>' > $(GLOBAL_TRSDK_ARCH)product-info.mf
	cp $(GLOBAL_TRSDK_NOARCH)aspera-license $(GLOBAL_TRSDK_ARCH)
	touch $@
# create template from actual private config file
template: $(CONFIG_TMPL)
$(CONFIG_TMPL): $(GLOBAL_CONFIG)
	sed '/^#/ d;s/^\(  [^:]*:\).*/\1 your_value_here/' < $(GLOBAL_CONFIG) > $(CONFIG_TMPL)
$(GLOBAL_CONFIG):
	@echo "Create a file: $@ from $(CONFIG_TMPL), refer to README.md"
	@echo "cp $(CONFIG_TMPL) $(GLOBAL_CONFIG)"
	@echo "vi $(GLOBAL_CONFIG)"
	@exit 1
tests:  .is_setup
	cd js && make
	cd python && make
	cd java && make
	cd web && make test
