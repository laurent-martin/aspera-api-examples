GBL_FILE_PATHS=$(DIR_TOP)config/paths.yaml
# folder with architecture independent files from the transfer SDK
SDK_DIR_NOARCH=$(DIR_TOP)$(shell sed -n -e 's/^trsdk_noarch: //p' < $(GBL_FILE_PATHS))/
# main folder for generated/downloaded files/temporary files
GBL_DIR_TMP=$(DIR_TOP)$(shell sed -n -e 's/^temp_gene: //p' $(GBL_FILE_PATHS))/
# location of transfer.proto
SDK_FILE_PROTO=$(DIR_TOP)$(shell sed -n -e 's/^proto: //p' $(GBL_FILE_PATHS))
# user's config file path
GBL_FILE_CONFIG=$(DIR_TOP)$(shell sed -n -e 's/^main_config: //p' $(GBL_FILE_PATHS))
# location of extracted transfer SDK
SDK_DIR_ROOT=$(DIR_TOP)$(shell sed -n -e 's/^sdk_root: //p' $(GBL_FILE_PATHS))/
# location of platform specific transfer SDK files (binaries)
SDK_DIR_ARCH=$(SDK_DIR_ROOT)$(shell sed -n -e 's/^ *platform: //p' $(GBL_FILE_CONFIG) 2> /dev/null)/
# downloaded SDK file
SDK_FILE_ZIP=$(SDK_DIR_ROOT)transfer_sdk.zip
# SDK executables
SDK_FILE_EXECS=$(SDK_DIR_ARCH)asperatransferd
# required files for running the samples
FILES_RUNTIME=$(GBL_FILE_CONFIG) $(SDK_DIR_ARCH)asperatransferd
# template configuration file
GBL_FILE_CONF_TMPL=$(DIR_TOP)config/config.tmpl
# sample file to transfer
GBL_FILE_SAMPLE=$(GBL_DIR_TMP)This_is_a_test.txt
# flag file that indicates that the folder was initialized
ENV_IS_SETUP=.is_setup
.PHONY: $(ENV_IS_SETUP)
# folder for test flags
DIR_TESTED_FLAG=./.tested/
TEST_FLAGS=$(foreach var,$(TEST_CASES),$(DIR_TESTED_FLAG)$(var))
.PHONY: all clean superclean clean_flags
all::
# clean flags indicating test was run: force re-run of tests only
clean_flags::
	rm -f $(TEST_FLAGS)
# simple clean
clean:: clean_flags
# clean all generated and compiled files
superclean:: clean
$(GBL_FILE_SAMPLE):
	mkdir -p $(GBL_DIR_TMP)
	@echo "Generating test file: $(GBL_FILE_SAMPLE)"
	date > $(GBL_FILE_SAMPLE)
$(DIR_TESTED_FLAG):
	mkdir -p $(DIR_TESTED_FLAG)
# config file info https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
# download transfer SDK
$(SDK_FILE_ZIP):
	mkdir -p $(SDK_DIR_ROOT)
	curl -L https://ibm.biz/aspera_transfer_sdk -o $(SDK_FILE_ZIP)
# Extract transfer SDK
# Note: Create the "etc" link because "ascp" expects to find "aspera-license" in one of . .. ../.. ./etc ../etc ../../etc
DIR_EXPECTED_LIC=$(SDK_DIR_ROOT)etc
$(SDK_DIR_ARCH)asperatransferd $(SDK_FILE_PROTO): $(SDK_FILE_ZIP)
	@echo $(SDK_DIR_ARCH)
	unzip -qud $(SDK_DIR_ROOT) $(SDK_FILE_ZIP)
	test -f $(SDK_FILE_PROTO)
	$(SDK_DIR_ARCH)/asperatransferd version | sed -Ee 's|^(.*) version (.*)\..*$$|<product><name>\1</name><version>\2</version></product>|' > $(SDK_DIR_ARCH)product-info.mf
	rm -f $(DIR_EXPECTED_LIC)
	ln -s noarch $(DIR_EXPECTED_LIC)
$(GBL_FILE_CONFIG):
	mkdir -p $$(dirname $@)
	cp $(GBL_FILE_CONF_TMPL) $@
	@echo 'Created file $@ using template $(GBL_FILE_CONF_TMPL), refer to README.md'
	@echo "\033[5m>>>> Edit and customize $@ <<<<\033[0m"
