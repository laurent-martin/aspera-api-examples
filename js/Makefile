# test file to transfer, here generated file, but could be real file with a path
DIR_TOP=$(CURDIR)/../
TEST_CASES=server server_v2
# cos
include $(DIR_TOP)common.mak
SRC=$(CURDIR)/
all:: $(TEST_FLAGS)
$(DIR_TESTED_FLAG)%: $(ENV_IS_SETUP) $(GBL_FILE_SAMPLE)
	@echo "== Test: $(notdir $@) ==========================="
	node $(SRC)$(notdir $@).js $(GBL_FILE_SAMPLE)
	@sleep 2
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
$(ENV_IS_SETUP): $(FILES_RUNTIME)
	npm install
	@touch $@
clean::
	rm -f package-lock.json
	rm -fr node_modules tmp
