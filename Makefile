# main folder (location of this makefile)
DIR_TOP=$(shell pwd -P)/
include $(DIR_TOP)common.mak
# template configurtion file
CONFIG_TMPL=$(DIR_TOP)config/config.tmpl
# user's config file path
CONFIG_FILE=$(DIR_TOP)$(shell sed -n -e 's/^main_config: //p' $(GLOBAL_PATHS))
# location of extracted transfer SDK
TRSDK_ROOT=$(DIR_TOP)$(shell sed -n -e 's/^sdk_root: //p' $(GLOBAL_PATHS))/
# location of platform specific transfer SDK files (binaries)
TRSDK_ARCH=$(TRSDK_ROOT)$(shell sed -n -e 's/^ *platform: //p' $(CONFIG_FILE) 2> /dev/null)/
# downloaded SDK file
TRSDK_ZIP=$(TRSDK_ROOT)transfer_sdk.zip
SECTIONS=js python java web cpp
all:: $(IS_OK)
# ensure that SDK is installed and config file are here
$(IS_OK): $(CONFIG_FILE) $(TRSDK_ARCH)asperatransferd
	@touch $@
# config file info https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
# download transfer SDK
$(TRSDK_ZIP):
	mkdir -p $(TRSDK_ROOT)
	curl -L https://ibm.biz/aspera_transfer_sdk -o $(TRSDK_ZIP)
# Extract transfer SDK
# Note: Create the "etc" link because "ascp" expects to find "aspera-license" in one of . .. ../.. ./etc ../etc ../../etc
$(TRSDK_ARCH)asperatransferd: $(TRSDK_ZIP)
	@echo $(TRSDK_ARCH)
	unzip -qud $(TRSDK_ROOT) $(TRSDK_ZIP)
	$(TRSDK_ARCH)/asperatransferd version | sed -Ee 's|^(.*) version (.*)\..*$$|<product><name>\1</name><version>\2</version></product>|' > $(TRSDK_ARCH)product-info.mf
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
tests: $(IS_OK)
	cd js && make
	cd python && make
	cd java && make
	cd ruby && make
	cd csharp && make
	cd cpp && make
	cd web && make test
clean::
	for sec in $(SECTIONS); do \
		pushd $$sec && make $@ && popd; \
	done
	find . -name \*.log -exec rm {} \;
	-killall asperatransferd
superclean::
	for sec in $(SECTIONS); do \
		pushd $$sec && make $@ && popd; \
	done
