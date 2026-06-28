MARP_IMAGE ?= marpteam/marp-cli
PROJECT_DIR ?= youtube-chat-rearranger
MARP_WORKDIR ?= /work/$(PROJECT_DIR)
MARP_INPUT ?= slide.md
MARP_OUTPUT ?= slide.pdf
MARP_ARGS ?= --allow-local-files

.PHONY: marp-pdf
marp-pdf:
	docker run --rm \
		-e MARP_USER="$$(id -u):$$(id -g)" \
		-v "$$(pwd):/work" -w "$(MARP_WORKDIR)" \
		$(MARP_IMAGE) "$(MARP_INPUT)" -o "$(MARP_OUTPUT)" $(MARP_ARGS)
