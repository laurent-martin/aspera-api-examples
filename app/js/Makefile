DIR_TOP=$(realpath ../..)/
TEST_CASES=server server_v2 node_v2 node faspex5 aoc cos
include $(DIR_TOP)common.mak
SRC=./src/
EXAMPLES=$(SRC)examples/
COMMON_SRC=$(SRC)utils/configuration.js $(SRC)utils/transfer_client.js
all:: $(TEST_FLAGS)
$(DIR_TESTED_FLAG)%: $(GBL_FILE_SAMPLE) $(FILES_RUNTIME) node_modules/.package-lock.json $(COMMON_SRC) $(EXAMPLES)%.js 
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
