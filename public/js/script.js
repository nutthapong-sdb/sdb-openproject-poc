document.addEventListener('DOMContentLoaded', async () => {
    // Check User Status
    checkUserStatus();

    // DEBUG: Test Project API directly
    fetch('/api/projects')
        .then(r => {
            console.log('DEBUG: /api/projects status:', r.status);
            return r.json().then(d => console.log('DEBUG: /api/projects data:', d));
        })
        .catch(e => console.error('DEBUG: /api/projects error:', e));

    // Event Listeners for Auth
    // $(document).on('click', '#loginBtn', openLoginModal); // Removed
    $(document).on('click', '#logoutBtn', handleLogout);

    // Initialize Select2 with AJAX (Projects)
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
                console.log('DEBUG: Select2 processResults received:', data);
                // Check if error (401)
                if (data.error) return { results: [] };

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
            cache: true,
            error: function (jqXHR, textStatus, errorThrown) {
                if (jqXHR.status === 401) {
                    // Trigger re-login or just show empty
                    console.log('Unauthorized fetch of projects');
                }
            }
        }
    });

    // Initialize Select2 for Assignee (Standard Select, populated dynamically)
    const assigneeSelect = $('#assigneeId').select2({
        width: '100%',
        placeholder: 'Select an Assignee'
    });

    // Function to Load Local Assignees
    const loadAssignees = async () => {
        try {
            const response = await fetch('/api/assignees');
            const users = await response.json();

            // Keep current selection if possible
            const currentVal = assigneeSelect.val();

            assigneeSelect.empty().append('<option value="" disabled selected>Select an Assignee</option>');

            users.forEach(user => {
                const option = new Option(user.name, user.id, false, false);
                assigneeSelect.append(option);
            });

            if (currentVal) assigneeSelect.val(currentVal).trigger('change');

        } catch (error) {
            console.error('Error loading local assignees:', error);
        }
    };

    // Load on start
    loadAssignees();

    // Manage Assignees Button Logic
    document.getElementById('manageAssigneesBtn').addEventListener('click', async () => {
        // Fetch current list for modal
        const response = await fetch('/api/assignees');
        const users = await response.json();

        let html = '<div style="text-align: left; max-height: 300px; overflow-y: auto;">';
        if (users.length === 0) html += '<p style="text-align:center;">No assignees found.</p>';
        else {
            html += '<ul style="list-style: none; padding: 0;">';
            users.forEach(u => {
                html += `<li style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #444;">
                    <span style="font-size: 0.95rem;">${u.name} <br><small style="color:#aaa;">(ID: ${u.openproject_id || 'N/A'})</small></span>
                    <div>
                        <button class="edit-btn" data-id="${u.id}" data-name="${u.name}" data-opid="${u.openproject_id || ''}" style="margin-right: 5px; padding: 4px 10px; font-size: 0.8rem; background-color: #2C2C2C; color: white; border: 1px solid #555; border-radius: 4px; cursor: pointer;">Edit</button>
                        <button class="delete-btn" data-id="${u.id}" style="padding: 4px 10px; font-size: 0.8rem; background-color: #CF6679; color: white; border: none; border-radius: 4px; cursor: pointer;">Del</button>
                    </div>
                </li>`;
            });
            html += '</ul>';
        }
        html += '</div><button id="addNewAssigneeBtn" class="swal2-confirm swal2-styled" style="margin-top: 15px; width: 100%;">+ Add New Assignee</button>';

        await Swal.fire({
            title: 'Manage Assignees',
            html: html,
            showConfirmButton: false,
            showCloseButton: true,
            width: 500,
            didOpen: () => {
                // Add New
                document.getElementById('addNewAssigneeBtn').addEventListener('click', () => {
                    Swal.close();
                    openAddEditModal();
                });

                // Edit
                document.querySelectorAll('.edit-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        Swal.close();
                        openAddEditModal(btn.dataset.id, btn.dataset.name, btn.dataset.opid);
                    });
                });

                // Delete
                document.querySelectorAll('.delete-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const id = btn.dataset.id;
                        if (confirm('Delete this assignee?')) {
                            await fetch(`/api/assignees/${id}`, { method: 'DELETE' });
                            Swal.close();
                            document.getElementById('manageAssigneesBtn').click(); // Re-open
                            loadAssignees(); // Reload dropdown
                        }
                    });
                });
            }
        });
    });

    const openAddEditModal = async (id = null, name = '', opId = '') => {
        const isEdit = !!id;

        await Swal.fire({
            title: isEdit ? 'Edit Assignee' : 'Add Assignee',
            html:
                `<div style="display:flex; flex-direction: column; gap: 10px;">` +
                `<input id="swal-input1" class="swal2-input" placeholder="Name (e.g. John Doe)" value="${name}" style="margin: 0;">` +
                `</div>`,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Save',
            confirmButtonColor: '#FF8F00',
            showLoaderOnConfirm: true,
            preConfirm: async () => {
                const newName = document.getElementById('swal-input1').value;
                if (!newName) {
                    Swal.showValidationMessage('Name is required');
                    return false;
                }

                const method = isEdit ? 'PUT' : 'POST';
                const url = isEdit ? `/api/assignees/${id}` : '/api/assignees';
                const currentProjectId = $('#projectId').val();

                try {
                    const response = await fetch(url, {
                        method: method,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: newName,
                            projectId: currentProjectId // Optional now
                        })
                    });

                    const res = await response.json();

                    if (!response.ok) {
                        throw new Error(res.error || 'Failed to save');
                    }

                    return res;
                } catch (error) {
                    Swal.showValidationMessage(`Error: ${error.message}`);
                    return false;
                }
            },
            allowOutsideClick: () => !Swal.isLoading()
        }).then((result) => {
            if (result.isConfirmed) {
                // Success
                Swal.fire('Success', 'Saved!', 'success')
                    .then(() => {
                        loadAssignees();
                        document.getElementById('manageAssigneesBtn').click(); // Re-open list
                    });
            } else if (result.dismiss === Swal.DismissReason.cancel) {
                // Cancelled
                document.getElementById('manageAssigneesBtn').click(); // Re-open list
            }
        });
    };

    // Enforce focus on search box when opened
    $(document).on('select2:open', () => {
        const searchField = document.querySelector('.select2-search__field');
        if (searchField) searchField.focus();
    });

    const form = document.getElementById('createTaskForm');
    const submitBtn = document.getElementById('submitBtn');
    const btnLoader = document.getElementById('btnLoader');
    const btnText = submitBtn.querySelector('span');

    // Percentage Buttons
    const percentBtns = document.querySelectorAll('.percent-btn');
    const percentInput = document.getElementById('percentageDone');

    percentBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all
            percentBtns.forEach(b => b.classList.remove('active'));
            // Add to clicked
            btn.classList.add('active');
            // Set value
            percentInput.value = btn.dataset.value;
        });
    });

    // Today Button
    document.getElementById('todayBtn').addEventListener('click', () => {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('startDate').value = today;
    });

    // Same Date Button
    document.getElementById('sameDateBtn').addEventListener('click', () => {
        const startDate = document.getElementById('startDate').value;
        if (startDate) {
            document.getElementById('dueDate').value = startDate;
        } else {
            Swal.fire({
                icon: 'info',
                text: 'Please select a Start Date first.',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000
            });
        }
    });

    // Detect Project Change to fetch Assignees - REMOVED for Local Management
    // $('#projectId').on('select2:select', ...);

    // 2. Handle Form Submit
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Get values
        const projectId = $('#projectId').val();
        const assigneeId = $('#assigneeId').val();
        const subject = document.getElementById('taskName').value;
        const startDate = document.getElementById('startDate').value;
        const dueDate = document.getElementById('dueDate').value;
        const percentageDone = document.getElementById('percentageDone').value;
        const spentHours = document.getElementById('spentHours').value; // Get hours

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
                body: JSON.stringify({
                    projectId,
                    subject,
                    assigneeId,
                    startDate,
                    dueDate,
                    percentageDone,
                    spentHours // Send to backend
                })
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

                let title = 'Task Created Successfully!';
                if (result.timeLogged) {
                    title = 'Task & Time Logged!';
                } else if (result.timeError) {
                    // Show warning toast for time error
                    Swal.fire({
                        icon: 'warning',
                        title: 'Task Created, but...',
                        text: result.timeError,
                        footer: `<a href="${result.webUrl}" target="_blank">Open Task</a>`
                    });
                    return; // Stop here to let user see modal
                }

                Toast.fire({
                    icon: 'success',
                    title: title,
                    html: `<a href="${result.webUrl}" target="_blank" style="color: #333; text-decoration: underline;">View Work Package #${result.id}</a>`
                });

                // Reset Form
                document.getElementById('taskName').value = '';
                document.getElementById('startDate').value = '';
                document.getElementById('dueDate').value = '';
                document.getElementById('spentHours').value = ''; // Reset hours
                document.getElementById('percentageDone').value = '0';
                percentBtns.forEach(b => b.classList.remove('active'));

                $('#projectId').val(null).trigger('change'); // Reset Select2
                $('#assigneeId').val(null).trigger('change').prop('disabled', true); // Reset Assignee

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




// --- Authentication Helpers ---

async function checkUserStatus() {
    try {
        const response = await fetch('/api/user');
        if (response.ok) {
            const user = await response.json();
            renderUserLoggedIn(user);
            // Enable app
            $('main').css('opacity', '1').css('pointer-events', 'auto');
        } else {
            // Not logged in -> Redirect to Login Page
            window.location.href = '/login.html';
        }
    } catch (e) {
        window.location.href = '/login.html';
    }
}

function renderUserLoggedIn(user) {
    const html = `
        <span style="font-size: 0.9rem; color: #aaa;">Hi, ${user.name}</span>
        <button id="logoutBtn" style="width: auto; padding: 6px 12px; font-size: 0.8rem; background-color: #333; border: 1px solid #555; color: #fff; cursor: pointer;">Logout</button>
    `;
    $('#userControls').html(html);
}

// openLoginModal removed - using login.html

async function handleLogout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
}
