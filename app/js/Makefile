DIR_TOP=$(realpath ..)/
TEST_CASES=server server_v2
# cos
include $(DIR_TOP)common.mak
SRC=./src/
EXAMPLES=$(SRC)examples/
all:: $(TEST_FLAGS)
$(DIR_TESTED_FLAG)%: node_modules/.package-lock.json $(GBL_FILE_SAMPLE)
	@echo "== Test: $(notdir $@) ==========================="
	node $(EXAMPLES)$(notdir $@).js $(GBL_FILE_SAMPLE)
	@sleep 2
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
node_modules/.package-lock.json:
	npm install
clean::
	rm -f package-lock.json
	rm -fr node_modules tmp
