DIR_TOP=$(realpath ../..)/
TEST_CASES=server
include $(DIR_TOP)common.mak
SRC=./src/
PUBLIC=./public/
DIST=./dist/
TMP_NPM=tmp_node/
all:: $(TEST_FLAGS)
run: $(DIST)server/server.js $(DIST)client/client.js
	node --trace-warnings $(DIST)server/server.js $$(realpath $(PUBLIC))
$(DIR_TESTED_FLAG)%: node_modules/.package-lock.json $(GBL_FILE_SAMPLE)
	@echo "== Test: $(notdir $@) ==========================="
	make run&
	sleep 5
	killall node
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
node_modules/.package-lock.json:
	npm install
clean::
	rm -f package-lock.json $(SRC)conf.js
	rm -f aspera-httpgw-example.zip
	rm -fr node_modules dist
zip:
	zip aspera-httpgw-example.zip $$(git ls-files)
$(DIST)client/client.js: node_modules/.package-lock.json $(SRC)client/client.ts
	npx tsc -p tsconfig.client.json
$(DIST)server/server.js: node_modules/.package-lock.json $(SRC)server/server.ts
	npx tsc -p tsconfig.server.json
