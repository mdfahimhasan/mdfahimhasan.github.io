# How to update your website

All of your content lives in the **`_data`** folder. You never need to touch any other file.

| To change…                           | Open this file              |
|--------------------------------------|-----------------------------|
| Name, job title, headline, bio, email, links, photo | `_data/profile.yml` |
| Research themes                      | `_data/research.yml`        |
| Jobs                                 | `_data/experience.yml`      |
| Degrees                              | `_data/education.yml`       |
| Papers and talks                     | `_data/publications.yml`    |
| Code and datasets                    | `_data/projects.yml`        |
| Skills                               | `_data/skills.yml`          |
| CV PDF                               | `assets/files/Fahim_Hasan_CV.pdf` (upload a new file with the same name) |

## Editing on GitHub.com (no software needed)

1. Go to your repository on GitHub and open the file (for example `_data/publications.yml`).
2. Click the **pencil icon** (Edit this file).
3. Make your change.
4. Click **Commit changes**.
5. Wait about a minute, then refresh your website.

## Common tasks

**Add a new paper:** in `_data/publications.yml`, copy one whole paper block (from `- title:` down to its last line), paste it at the top of the `papers:` list, and change the text. Your name is bolded automatically.

**Add a new job:** in `_data/experience.yml`, copy a block, paste it at the top, and edit it. Move `current: true` to the new job and delete it from the old one.

**Add your photo:** upload an image to `assets/img/` (click *Add file → Upload files*), then in `_data/profile.yml` set `photo: "your-file-name.jpg"`.

**Replace your CV:** go to `assets/files/`, click *Add file → Upload files*, and upload your new PDF named exactly `Fahim_Hasan_CV.pdf`. It will replace the old one.

## Three rules that prevent errors

1. **Keep the spacing.** Indentation (the spaces at the start of lines) matters. Copy an existing block and keep its spacing exactly.
2. **Keep text inside quotation marks.** If your text itself contains a `"`, use `'` instead.
3. **If the site stops updating,** open the **Actions** tab in your repository. A red ✗ means a typo in the last edit; the error message names the file and line.

Or simply ask Claude: "Update my website: here's what changed," and attach your new CV.
