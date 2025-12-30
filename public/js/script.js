document.addEventListener('DOMContentLoaded', async () => {
    $('#projectId').select2({
        width: '100%',
        placeholder: 'Search for a project...',
        minimumInputLength: 0,
        ajax: {
            url: '/api/projects',
            dataType: 'json',
            delay: 250,
            data: function (params) {
                return {
                    q: params.term
                };
            },
            processResults: function (data) {
                // Ensure array
                let projects = [];
                if (Array.isArray(data)) {
                    projects = data;
                } else if (data._embedded && data._embedded.elements) {
                    projects = data._embedded.elements;
                }

                return {
                    results: projects.map(project => ({
                        id: project.id,
                        text: project.name
                    }))
                };
            },
            cache: true
        }
    });

    // Enforce focus on search box when opened (standard behavior, but enforcing just in case)
    $(document).on('select2:open', () => {
        document.querySelector('.select2-search__field').focus();
    });

    const form = document.getElementById('createTaskForm');
    const submitBtn = document.getElementById('submitBtn');
    const btnLoader = document.getElementById('btnLoader');
    const btnText = submitBtn.querySelector('span');

    /* Old Select2/Fetch logic removed */


    // 2. Handle Form Submit
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Get value from Select2 directly
        const projectId = $('#projectId').val();
        const subject = document.getElementById('taskName').value;

        if (!projectId || !subject) {
            Swal.fire({
                icon: 'warning',
                title: 'Missing Info',
                text: 'Please select a project and enter a task name.',
                confirmButtonColor: '#FF8F00'
            });
            return;
        }

        // Loading State
        submitBtn.disabled = true;
        btnText.style.display = 'none';
        btnLoader.style.display = 'block';

        try {
            const response = await fetch('/api/work_packages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ projectId, subject })
            });

            const result = await response.json();

            if (response.ok) {
                // Toast Notification
                const Toast = Swal.mixin({
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 5000,
                    timerProgressBar: true,
                    didOpen: (toast) => {
                        toast.addEventListener('mouseenter', Swal.stopTimer)
                        toast.addEventListener('mouseleave', Swal.resumeTimer)
                    },
                    customClass: {
                        popup: 'colored-toast'
                    }
                });

                Toast.fire({
                    icon: 'success',
                    title: 'Task Created Successfully!',
                    html: `<a href="${result.webUrl}" target="_blank" style="color: var(--primary-color); text-decoration: underline;">View Work Package #${result.id}</a>`
                });

                document.getElementById('taskName').value = ''; // Reset input
                $('#projectId').val(null).trigger('change'); // Reset Select2
            } else {
                throw new Error(result.errorIdentifier || result.message || 'Unknown error');
            }

        } catch (error) {
            console.error('Error creating task:', error);
            Swal.fire({
                icon: 'error',
                title: 'Failed',
                text: error.message || 'Something went wrong.',
                confirmButtonColor: '#CF6679'
            });
        } finally {
            // Reset Loading State
            submitBtn.disabled = false;
            btnText.style.display = 'block';
            btnLoader.style.display = 'none';
        }
    });
});
