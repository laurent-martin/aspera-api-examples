GLOBAL_PATHS=$(DIR_TOP)config/paths.yaml
GLOBAL_TRSDK_NOARCH=$(DIR_TOP)$(shell sed -n -e 's/^trsdk_noarch: //p' < $(GLOBAL_PATHS))/
# main folder for generated/downloaded files/temporary files
DIR_TMP=$(DIR_TOP)$(shell sed -n -e 's/^temp_gene: //p' $(GLOBAL_PATHS))/
SAMPLE_FILE=$(DIR_TMP)This_is_a_test.txt
# flag file that indicates that the folder was initialized
IS_OK=.is_setup
# prefix for test flags
T=.tested.
all::
clean_flags:
	rm -f $(IS_OK)
	test -n "$(T)" && rm -f $(T)*
clean:: clean_flags
superclean:: clean
	rm -fr $(DIR_TMP)
# ensure SDK is there
$(DIR_TOP)$(IS_OK):
	cd (DIR_TOP) && make
$(SAMPLE_FILE):
	@echo "Generating test file: $(SAMPLE_FILE)"
	date > $(SAMPLE_FILE)
.PHONY: all clean superclean
