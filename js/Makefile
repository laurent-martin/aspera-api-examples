# test file to transfer, here generated file, but could be real file with a path
DIR_TOP=$(CURDIR)/../
TEST_CASES=server server_v2 cos
include $(DIR_TOP)common.mak
SRC=$(CURDIR)/
all:: $(TEST_FLAGS)
$(FLAG_DIR)%: $(ENV_IS_SETUP) $(SAMPLE_FILE)
	@echo "== Test: $(notdir $@) ==========================="
	node $(SRC)$(notdir $@).js $(SAMPLE_FILE)
	@sleep 2
	@mkdir -p $(FLAG_DIR)
	@touch $@
$(ENV_IS_SETUP): $(SDK_FILES)
	npm install
	@touch $@
clean::
	rm -f package-lock.json
	rm -fr node_modules tmp
