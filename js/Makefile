# test file to transfer, here generated file, but could be real file with a path
FILE_TRANSFER=faux:///100m?100m
all: run
run: .is_setup
	cd .. && make startdaemon&
	node server.js '$(FILE_TRANSFER)'
	node server_v2.js '$(FILE_TRANSFER)'
	cd .. && make stopdaemon
.is_setup:
	npm install
	touch $@
setup: .is_setup
clean:
	rm -f .is_setup package-lock.json file
	rm -fr node_modules tmp
