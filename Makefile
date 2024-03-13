DIR_TOP=$(shell pwd -P)/
include $(DIR_TOP)common.make
CONFIG_TMPL=$(DIR_TOP)config/config.tmpl
CONFIG_FILE=$(DIR_TOP)$(shell sed -n -e 's/^main_config: //p' $(GLOBAL_PATHS))
GENERATED_ROOT=$(DIR_TOP)$(shell sed -n -e 's/^temp_gene: //p' $(GLOBAL_PATHS))/
TRSDK_ROOT=$(DIR_TOP)$(shell sed -n -e 's/^sdk_root: //p' $(GLOBAL_PATHS))/
TRSDK_ARCH=$(TRSDK_ROOT)$(shell sed -n -e 's/^ *system_type: //p' $(CONFIG_FILE) 2> /dev/null)/
TRSDK_ZIP=$(TRSDK_ROOT)transfer_sdk.zip
all:: $(IS_OK)
clean: clean_flags
	cd js && make clean
	cd python && make clean
	cd java && make clean
	cd web && make clean
	rm -fr $(GENERATED_ROOT)
	find . -name \*.log -exec rm {} \;
	-killall asperatransferd
# ensure that SDK is installed and config file are here
$(IS_OK): $(CONFIG_FILE) $(TRSDK_ARCH)asperatransferd
	@touch $@
# config file info https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
# download transfer SDK
$(TRSDK_ZIP):
	mkdir -p $(TRSDK_ROOT)
	curl -L https://ibm.biz/aspera_transfer_sdk -o $(TRSDK_ZIP)
# extract transfer SDK
# Note: create the link: etc because the SDK configuration does not use its "etc" configuration.
$(TRSDK_ARCH)asperatransferd: $(TRSDK_ZIP)
	@echo $(TRSDK_ARCH)
	unzip -qud $(TRSDK_ROOT) $(TRSDK_ZIP)
	echo '<product><name>IBM Aspera SDK</name><version>1.1.1.52</version></product>' > $(TRSDK_ARCH)product-info.mf
	ln -s noarch $(TRSDK_ROOT)etc
	@touch $@
# create template from actual private config file
DOC_TOOL=ruby -I $(DIR_TOP)/doc -r doc -e
template: $(CONFIG_TMPL)
$(CONFIG_TMPL): $(CONFIG_FILE)
	$(DOC_TOOL) generate_config_template $(CONFIG_FILE) $@
$(CONFIG_FILE):
	mkdir -p $$(dirname $@)
	cp $(CONFIG_TMPL) $@
	@echo 'Created file $@ using template $(CONFIG_TMPL), refer to README.md'
	@echo "\033[5m>>>> Edit and customize $@ <<<<\033[0m"
tests:  $(IS_OK)
	cd js && make
	cd python && make
	cd java && make
	cd ruby && make
	cd csharp && make
	cd web && make test
