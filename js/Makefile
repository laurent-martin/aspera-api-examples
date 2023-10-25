# test file to transfer, here generated file, but could be real file with a path
DIR_TOP=$(shell pwd -P)/../
include $(DIR_TOP)common.make
SRC=
TSTFILE='faux:///100m?100m'
all: server$(T) server_v2$(T)
%$(T): $(IS_OK)
	node $(SRC)$$(basename $@ $(T)).js $(TSTFILE)
	sleep 2
	touch $@
../$(IS_OK):
	cd .. && make
$(IS_OK): ../$(IS_OK)
	npm install
	touch $@
clean:
	test -n "$(T)" && rm -f *$(T)
	rm -f $(IS_OK)
	rm -f package-lock.json
	rm -fr node_modules tmp
