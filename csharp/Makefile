DIR_TOP=$(CURDIR)/../
TEST_CASES=server_upload faspex5 aoc
include $(DIR_TOP)common.mak
PROPERTIES=-p:Proto_File=$(PROTO_FILE)
all:: $(TEST_FLAGS)
$(FLAG_DIR)%: $(ENV_IS_SETUP) $(SAMPLE_FILE)
	@echo "== Test: $(notdir $@) ==========================="
	dotnet run $(PROPERTIES) $(notdir $@) $(SAMPLE_FILE)
	@sleep 2
	@mkdir -p $(FLAG_DIR)
	@touch $@
$(ENV_IS_SETUP): $(SDK_FILES)
	@touch $@
build:
	dotnet build $(PROPERTIES)
clean::
	dotnet clean
superclean::
	rm -fr dist obj bin
