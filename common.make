GLOBAL_PATHS=$(DIR_TOP)config/paths.yaml
GLOBAL_TRSDK_NOARCH=$(DIR_TOP)$(shell sed -n -e 's/^trsdk_noarch: //p' < $(GLOBAL_PATHS))/
# flag file that indicates that the folder was initialized
IS_OK=.is_setup
# prefix for test flags
T=.tested.
all::
clean_flags:
	rm -f $(IS_OK)
	test -n "$(T)" && rm -f $(T)*
