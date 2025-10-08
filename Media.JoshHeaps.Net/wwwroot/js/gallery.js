// Lazy loading for gallery images using Intersection Observer
let currentOffset = 20; // Initial load was 20 items
let isLoading = false;
let hasMore = true;

// Create intersection observer for lazy loading
const loadingElement = document.getElementById('loading');
const galleryElement = document.getElementById('gallery');

if (loadingElement && galleryElement) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !isLoading && hasMore) {
                loadMoreImages();
            }
        });
    }, {
        rootMargin: '200px' // Start loading 200px before the element comes into view
    });

    observer.observe(loadingElement);
}

async function loadMoreImages() {
    if (isLoading || !hasMore) return;

    isLoading = true;
    loadingElement.style.display = 'block';

    try {
        const response = await fetch(`/api/media/load?offset=${currentOffset}&limit=20`);

        if (!response.ok) {
            throw new Error('Failed to load images');
        }

        const mediaItems = await response.json();

        if (mediaItems.length === 0) {
            hasMore = false;
            loadingElement.style.display = 'none';
            return;
        }

        // Add new images to gallery
        mediaItems.forEach(media => {
            const galleryItem = createGalleryItem(media);
            galleryElement.appendChild(galleryItem);
        });

        currentOffset += mediaItems.length;
    } catch (error) {
        console.error('Error loading images:', error);
        loadingElement.innerHTML = 'Failed to load more images.';
    } finally {
        isLoading = false;
        if (hasMore) {
            loadingElement.style.display = 'none';
        }
    }
}

function createGalleryItem(media) {
    const item = document.createElement('div');
    item.className = 'gallery-item';
    item.setAttribute('data-media-id', media.id);

    const img = document.createElement('img');
    img.src = `/api/media/image/${media.id}`;
    img.alt = media.fileName;
    img.loading = 'lazy';
    item.appendChild(img);

    if (media.description) {
        const desc = document.createElement('div');
        desc.className = 'gallery-item-description';
        desc.textContent = media.description;
        item.appendChild(desc);
    }

    const info = document.createElement('div');
    info.className = 'gallery-item-info';

    const date = document.createElement('span');
    date.className = 'gallery-item-date';
    const createdDate = new Date(media.createdAt);
    date.textContent = createdDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    info.appendChild(date);

    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/?handler=Delete';
    form.style.display = 'inline';

    // Add anti-forgery token
    const tokenInput = document.querySelector('input[name="__RequestVerificationToken"]');
    if (tokenInput) {
        const tokenClone = tokenInput.cloneNode(true);
        form.appendChild(tokenClone);
    }

    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    hiddenInput.name = 'mediaId';
    hiddenInput.value = media.id;
    form.appendChild(hiddenInput);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'submit';
    deleteBtn.className = 'btn-delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = function(e) {
        return confirm('Are you sure you want to delete this image?');
    };
    form.appendChild(deleteBtn);

    info.appendChild(form);
    item.appendChild(info);

    return item;
}

// Optional: Add image preview on click
galleryElement?.addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG') {
        const modal = createImageModal(e.target.src);
        document.body.appendChild(modal);
    }
});

function createImageModal(imageSrc) {
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-content">
            <img src="${imageSrc}" alt="Full size image" />
            <button class="modal-close">&times;</button>
        </div>
    `;

    modal.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-backdrop') ||
            e.target.classList.contains('modal-close') ||
            e.target.classList.contains('image-modal')) {
            modal.remove();
        }
    });

    return modal;
}
