GLOBAL_PATHS=$(DIR_TOP)config/paths.yaml
GLOBAL_TRSDK_NOARCH=$(DIR_TOP)$(shell sed -n -e 's/^trsdk_noarch: //p' < $(GLOBAL_PATHS))/
# main folder for generated/downloaded files/temporary files
DIR_TMP=$(DIR_TOP)$(shell sed -n -e 's/^temp_gene: //p' $(GLOBAL_PATHS))/
PROTO_FILE=$(DIR_TOP)$(shell sed -n -e 's/^proto: //p' $(GLOBAL_PATHS))
SAMPLE_FILE=$(DIR_TMP)This_is_a_test.txt
# user's config file path
CONFIG_FILE=$(DIR_TOP)$(shell sed -n -e 's/^main_config: //p' $(GLOBAL_PATHS))
# location of extracted transfer SDK
TRSDK_ROOT=$(DIR_TOP)$(shell sed -n -e 's/^sdk_root: //p' $(GLOBAL_PATHS))/
# location of platform specific transfer SDK files (binaries)
TRSDK_ARCH=$(TRSDK_ROOT)$(shell sed -n -e 's/^ *platform: //p' $(CONFIG_FILE) 2> /dev/null)/
# downloaded SDK file
TRSDK_ZIP=$(TRSDK_ROOT)transfer_sdk.zip
SDK_FILES=$(CONFIG_FILE) $(TRSDK_ARCH)asperatransferd $(PROTO_FILE)
# template configuration file
CONFIG_TMPL=$(DIR_TOP)config/config.tmpl
# flag file that indicates that the folder was initialized
IS_OK=.is_setup
# prefix for test flags
T=.tested.
FLAG_DIR=$(DIR_TMP)$(notdir $(CURDIR))/
TEST_FLAGS=$(foreach var,$(TEST_CASES),$(FLAG_DIR)$(var))
all::
clean_flags:
	rm -f $(IS_OK)
	test -n "$(T)" && rm -f $(T)*
clean:: clean_flags
superclean:: clean
	rm -fr $(DIR_TMP)
$(DIR_TMP):
	mkdir -p $(DIR_TMP)
$(SAMPLE_FILE): $(DIR_TMP)
	@echo "Generating test file: $(SAMPLE_FILE)"
	date > $(SAMPLE_FILE)
$(FLAG_DIR):
	mkdir -p $(FLAG_DIR)
.PHONY: all clean superclean
# config file info https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
# download transfer SDK
$(TRSDK_ZIP):
	mkdir -p $(TRSDK_ROOT)
	curl -L https://ibm.biz/aspera_transfer_sdk -o $(TRSDK_ZIP)
# Extract transfer SDK
# Note: Create the "etc" link because "ascp" expects to find "aspera-license" in one of . .. ../.. ./etc ../etc ../../etc
$(TRSDK_ARCH)asperatransferd $(PROTO_FILE): $(TRSDK_ZIP)
	@echo $(TRSDK_ARCH)
	unzip -qud $(TRSDK_ROOT) $(TRSDK_ZIP)
	test -f $(PROTO_FILE)
	$(TRSDK_ARCH)/asperatransferd version | sed -Ee 's|^(.*) version (.*)\..*$$|<product><name>\1</name><version>\2</version></product>|' > $(TRSDK_ARCH)product-info.mf
	ln -s noarch $(TRSDK_ROOT)etc
	@touch $@
$(CONFIG_FILE):
	mkdir -p $$(dirname $@)
	cp $(CONFIG_TMPL) $@
	@echo 'Created file $@ using template $(CONFIG_TMPL), refer to README.md'
	@echo "\033[5m>>>> Edit and customize $@ <<<<\033[0m"
