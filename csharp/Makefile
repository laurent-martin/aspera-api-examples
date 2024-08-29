DIR_TOP=$(CURDIR)/../
TEST_CASES=server_upload faspex5 aoc
include $(DIR_TOP)common.mak
PROPERTIES=-p:Proto_File=$(SDK_FILE_PROTO)
all:: $(TEST_FLAGS)
$(DIR_TESTED_FLAG)%: $(ENV_IS_SETUP) $(GBL_FILE_SAMPLE)
	@echo "== Test: $(notdir $@) ==========================="
	dotnet run $(PROPERTIES) $(notdir $@) $(GBL_FILE_SAMPLE)
	@sleep 2
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
$(ENV_IS_SETUP): $(FILES_RUNTIME)
	@touch $@
build:
	dotnet build $(PROPERTIES)
clean::
	dotnet clean
superclean::
	rm -fr dist obj bin
