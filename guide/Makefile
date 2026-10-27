ifndef GFM2PDF_HOME
$(error The environment variable GFM2PDF_HOME is not set. Please set it and try again.)
endif
# Look of the PDF, e.g. the theme of aspera-cli: build/doc/pdf_theme
ifndef GFM2PDF_THEME
$(error The environment variable GFM2PDF_THEME is not set. Please set it and try again.)
endif
# gfm2pdf-toolchain 1.x: themes, options of a document in a comment <!-- gfm2pdf
GFM2PDF_VERSION_REQUIRED ?= >= 1.0.0.pre, < 2
include $(GFM2PDF_HOME)/pandoc.mak

DIR_TOP=$(CURDIR)/../
include $(DIR_TOP)common.mak
# create template from actual private config file
DOC_TOOL=ruby -I $(DIR_TOP)/guide -r doc -e
$(GBL_FILE_CONF_TMPL): $(GBL_FILE_CONFIG)
	$(DOC_TOOL) generate_config_template $(GBL_FILE_CONFIG) $@
all:: $(GBL_FILE_CONF_TMPL) README.pdf
clean::
	rm -f $(GBL_FILE_CONF_TMPL)
pdf: README.pdf
# one image per tab of the drawio file, named after the tab: regenerated only if older than the drawio file
DRAWIO_FILE=images/diagrams.drawio
DRAWIO_IMAGES:=$(shell $(DOC_TOOL) list_drawio_images $(DRAWIO_FILE) svg)
$(DRAWIO_IMAGES): images/%.svg: $(DRAWIO_FILE)
	$(DOC_TOOL) export_drawio_tab $< $@ --scale 2 --transparent
README.pdf: $(DRAWIO_IMAGES)
