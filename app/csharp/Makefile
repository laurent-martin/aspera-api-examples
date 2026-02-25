DIR_TOP=$(realpath ../..)/
TEST_CASES=server faspex5 aoc
include $(DIR_TOP)common.mak
PROPERTIES=-p:Proto_File=$(SDK_FILE_PROTO)
all:: $(TEST_FLAGS)
$(DIR_TESTED_FLAG)%: $(FILES_RUNTIME) $(GBL_FILE_SAMPLE) $(shell find src -name "*.cs")
	@echo "== Test: $(notdir $@) ==========================="
	dotnet run $(PROPERTIES) $(notdir $@) $(GBL_FILE_SAMPLE)
	@sleep 2
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
build:
	dotnet build $(PROPERTIES)
clean::
	rm -fr bin obj
clean_lang:
	dotnet clean
superclean::
	rm -fr dist obj bin
