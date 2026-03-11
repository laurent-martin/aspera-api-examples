DIR_TOP=$(realpath ..)/
TEST_CASES=server
include $(DIR_TOP)common.mak
SRC=./src/
PUBLIC=./public/
DIST=./dist/
TMP_NPM=tmp_node/
# indicate that node modules are installed
INSTALL_FLAG=node_modules/.package-lock.json
all:: $(TEST_FLAGS)
# run server and vite proxy
run: $(INSTALL_FLAG)
	npm run all
# run only the server
server: $(DIST)server/server.js $(DIST)client/client.js
	node --trace-warnings $(DIST)server/server.js $(DIR_TOP) $(PUBLIC)
# run server for a few seconds and then kill it
$(DIR_TESTED_FLAG)%: $(INSTALL_FLAG) $(GBL_FILE_SAMPLE)
	@echo "== Test: $(notdir $@) ==========================="
	make run&
	sleep 5
	curl -X POST http://localhost:9080/api/shutdown
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
# install dependencies
$(INSTALL_FLAG): package.json
	npm install
zip:
	zip aspera-httpgw-example.zip $$(git ls-files)
$(DIST)client/client.js: $(INSTALL_FLAG) $(SRC)client/client.ts
	npx tsc -p tsconfig.client.json
$(DIST)server/server.js: $(INSTALL_FLAG) $(SRC)server/server.ts
	npx tsc -p tsconfig.server.json
clean::
	rm -f package-lock.json $(SRC)conf.js
	rm -f aspera-httpgw-example.zip
	rm -fr node_modules dist
