import {
  Form,
  useActionData,
  useSubmit,
  useTransition,
} from "@remix-run/react";
import { ChangeEvent, FC, useRef, useState } from "react";
import ReactSelect, { MultiValue } from "react-select";
import cx from "classnames";
import { parseMarkdown } from "~/utils/markdown";
import Button from "~/components/Button";
import TextArea from "~/components/TextArea";
import TextField from "~/components/TextField";
import {
  ROLE_INTERESTS,
  SUBJECT_INTERESTS,
  TECH_INTERESTS,
} from "~/utils/tags";
import formStyles from "~/styles/forms.css";
import markdownStyles from "~/styles/markdown.css";
import TwitterIcon from "~/components/icons/TwitterIcon";
import { LinkIcon, MarkGithubIcon } from "@primer/octicons-react";
import ProjectPreview from "~/components/ProjectPreview";
import { Project } from "~/types";
import ProjectSubmissionSpinner from "~/components/ProjectSubmissionSpinner";
import RequiredMarker from "~/components/RequiredMarker";
import ExternalLink from "~/components/ExternalLink";
import mapThumbnailSrc from "~/images/map_thumbnail.png";
import { formatFileSize, maybeStringToArray } from "~/utils/formatting";
import FieldError from "~/components/FieldError";
import {
  ActionFunction,
  json,
  LoaderFunction,
  redirect,
} from "@remix-run/node";
import { getCurrentUser, getCurrentUserOrRedirect } from "~/session.server";
import {
  MAX_AVATAR_SIZE_BYTES,
  parseListProjectForm,
} from "~/utils/project-submission";
import { createNewPullRequest } from "~/github.server";
import { getRepoOwnerAndName } from "~/utils/repo-url";
import { getProjectByRepoUrl } from "~/projects.server";
import ProjectSubmissionConfirmation from "~/components/ProjectSubmissionConfirmation";
import { getRepeatableFieldValues } from "~/utils/forms";
import RepeatableTextFields from "~/components/RepeatableTextFields";

export function links() {
  return [
    { rel: "stylesheet", href: formStyles },
    { rel: "stylesheet", href: markdownStyles },
  ];
}

/**
 * Check that the user is logged in or redirect to the /login page
 */
export const loader: LoaderFunction = async ({ request }) => {
  await getCurrentUserOrRedirect(request);
  return json({});
};

/**
 * This method is called when the form is submitted. It performs data validation
 * and uploads files to GitHub before creating a PR. If all goes well, it
 * redirects to a success page.
 */
export const action: ActionFunction = async ({ request }) => {
  const currentUser = await getCurrentUser(request);

  if (!currentUser) {
    // You must be logged in to save your profile!
    return redirect("/login");
  }

  // Parse the form
  const { validationErrors, files, repoUrl } = await parseListProjectForm(
    request,
    currentUser
  );

  // If there are any validation errors, return early
  if (validationErrors) {
    return json({ validationErrors });
  }

  if (!repoUrl) {
    throw new Error("Missing repo URL in new project form");
  }

  // Verify that we don't already have a project for this repository
  const matchingProject = getProjectByRepoUrl(repoUrl);
  if (matchingProject) {
    return json({
      validationErrors: {
        repoUrl: "This project is already listed on Open Source Hub",
      },
    });
  }

  // Create a new pull request with the content of the form
  const { owner: repoOwner, name: repoName } = getRepoOwnerAndName(repoUrl);
  const { pullRequestUrl } = await createNewPullRequest(
    currentUser,
    files,
    repoOwner,
    repoName
  );

  return redirect(`/project-listed?pr=${encodeURIComponent(pullRequestUrl)}`);
};

type TagsState = {
  languages: MultiValue<{ label: string; value: string }>;
  currentlySeeking: MultiValue<{ label: string; value: string }>;
  tags: MultiValue<{ label: string; value: string }>;
};

/**
 * This (massive) form allows users to list their projects on Open Source Hub.
 */
const ListProject: FC = () => {
  const transition = useTransition();
  const actionData = useActionData();
  const submit = useSubmit();

  // The 3 tag dropdowns are controlled components and we keep track of their state here
  const [tags, setTags] = useState<TagsState>({
    languages: [],
    currentlySeeking: [],
    tags: [],
  });

  const updateTags =
    (key: keyof TagsState) =>
    (updatedTags: MultiValue<{ label: string; value: string }>) => {
      setTags({ ...tags, [key]: updatedTags });
    };

  const formRef = useRef<HTMLFormElement>(null);

  // Store a Project that can be used to preview the form
  const [projectPreview, setProjectPreview] = useState<Project>();

  // Show/hide the preview modal
  const [showPreview, setShowPreview] = useState(false);

  // Display a preview of the new project
  const displayPreview = () => {
    if (!formRef.current) return;

    const formData = new FormData(formRef.current);

    let featuredMap: Project["attributes"]["featuredMap"];
    const featuredMapUrl = formData.get("featuredMapUrl")?.toString();
    const featuredMapDescription = formData
      .get("featuredMapDescription")
      ?.toString();
    if (featuredMapUrl) {
      featuredMap = {
        description: featuredMapDescription || "",
        url: featuredMapUrl,
      };
    }

    const overview = parseMarkdown(formData.get("overview")?.toString() || "");
    const contributing = parseMarkdown(
      formData.get("contributing")?.toString() || ""
    );

    const project: Project = {
      attributes: {
        created: new Date().toISOString(),
        maintainer: "current user",
        name: formData.get("name")?.toString() || "",
        repoUrl: formData.get("repoUrl")?.toString() || "",
        description: formData.get("description")?.toString(),
        tags: maybeStringToArray(formData.get("tags")?.toString()),
        currentlySeeking: maybeStringToArray(
          formData.get("currentlySeeking")?.toString()
        ),
        languages: maybeStringToArray(formData.get("languages")?.toString()),
        avatar: avatarSrc.src,
        featuredMap,
        reviewMapUrls: getRepeatableFieldValues("reviewMapUrls", formData),
      },
      body: {
        contributing,
        overview,
      },
      organization: "preview",
      slug: "preview",
    };

    setProjectPreview(project);
    setShowPreview(true);
  };

  // Keep track of data related to the avatar
  const [avatarSrc, setAvatarSrc] = useState({
    src: "",
    size: "",
    error: "",
  });

  // Preview the avatar when the user uploads one
  const updateAvatarPreview = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.currentTarget.files && event.currentTarget.files.length > 0) {
      const file = event.currentTarget.files[0];
      if (file.size <= MAX_AVATAR_SIZE_BYTES) {
        setAvatarSrc({
          src: URL.createObjectURL(file),
          error: "",
          size: formatFileSize(file.size),
        });
      } else {
        event.currentTarget.value = "";
        setAvatarSrc({
          src: "",
          error: `Please choose a file smaller than ${formatFileSize(
            MAX_AVATAR_SIZE_BYTES
          )}`,
          size: "",
        });
      }
    }
  };

  // Show a confirmation modal before submitting the form
  const [confirmation, setConfirmation] = useState(false);
  const submitForm = () => {
    setConfirmation(false);
    submit(formRef.current);
  };

  return (
    <div>
      <ProjectPreview
        isOpen={showPreview}
        project={projectPreview}
        closePreview={() => setShowPreview(false)}
      />
      <ProjectSubmissionConfirmation
        isOpen={confirmation}
        onCancel={() => setConfirmation(false)}
        onConfirm={submitForm}
      />
      <ProjectSubmissionSpinner state={transition.state} />
      <main className="max-w-4xl mx-auto pt-12 px-2 pb-24">
        <h1 className="text-light-type text-2xl font-semibold mb-8">
          List your project
        </h1>
        <Form
          action="/list-project"
          method="post"
          ref={formRef}
          encType="multipart/form-data"
        >
          <div className="px-4 mb-20 space-y-4">
            <div className="flex gap-6 max-w-xl">
              <div className="space-y-4 grow">
                <div>
                  <TextField id="name" label="Project name" required />
                  <FieldError error={actionData?.validationErrors?.name} />
                </div>
                <div>
                  <TextField
                    id="repoUrl"
                    label={
                      <>
                        <MarkGithubIcon className="w-4 h-4 mr-1" /> GitHub
                        repository
                      </>
                    }
                    placeholder="https://github.com/Codesee-io/opensourcehub"
                    required
                  />
                  <FieldError error={actionData?.validationErrors?.repoUrl} />
                </div>
              </div>
              <div>
                <label
                  className="input-label justify-center mb-2"
                  htmlFor="avatar"
                >
                  Avatar
                </label>
                <div
                  className="bg-light-interactive-2-background border border-light-type-disabled-solid relative rounded-full"
                  style={{ width: 140, height: 140 }}
                >
                  {avatarSrc.src && (
                    <img
                      src={avatarSrc.src}
                      className="object-cover object-center rounded-full absolute inset-0 w-full h-full"
                      width="140"
                      height="140"
                      alt="Project avatar"
                    />
                  )}
                  <div
                    className={cx(
                      "absolute inset-0 p-2 rounded-full flex flex-col gap-2 items-center justify-center hover:opacity-100 transition-opacity",
                      {
                        "opacity-0": avatarSrc.src.length > 0,
                      }
                    )}
                  >
                    <input
                      id="avatar"
                      name="avatar"
                      type="file"
                      accept=".png, .jpg, .jpeg"
                      onChange={updateAvatarPreview}
                      className="hidden"
                    />
                    <label
                      htmlFor="avatar"
                      className="font-semibold text-light-interactive cursor-pointer p-2 bg-light-interactive-fill rounded"
                    >
                      {avatarSrc.src ? "Replace" : "Upload"}
                    </label>
                    {avatarSrc.error ? (
                      <div className="text-warning-dark text-xs text-center">
                        {avatarSrc.error}
                      </div>
                    ) : (
                      <div className="text-xs text-center text-light-type-medium">
                        200px &times; 200px
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="max-w-xl space-y-4">
              <div>
                <TextField id="description" label="Description" required />
                <FieldError error={actionData?.validationErrors?.description} />
              </div>
              <div className="flex gap-4">
                <div className="grow">
                  <TextField
                    type="url"
                    label={
                      <>
                        <LinkIcon className="w-4 h-4 mr-1" /> Website URL
                      </>
                    }
                    id="websiteUrl"
                    placeholder="https://your-website.com"
                  />
                </div>
                <div className="grow">
                  <TextField
                    type="url"
                    label={
                      <>
                        <TwitterIcon className="w-4 h-4 mr-1" /> Twitter URL
                      </>
                    }
                    id="twitterUrl"
                    placeholder="https://twitter.com/username"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-light-border p-4 rounded-lg mb-8">
            <h2 className="font-bold text-lg mb-4">CodeSee Map</h2>
            <p>
              We recommend providing a CodeSee Map to help onboard newcomers to
              your project. It's free!{" "}
              <ExternalLink href="https://app.codesee.io/maps/public/f5dcb920-ee8f-11ec-a5b3-bb55880b8b59">
                View an example map.
              </ExternalLink>
            </p>
            <div className="flex mt-6 gap-8">
              <div className="space-y-4 w-2/3">
                <div>
                  <TextField
                    label="Public Map URL"
                    type="url"
                    id="featuredMapUrl"
                    placeholder="https://app.codesee.io/maps/public/example-map"
                  />
                  <FieldError
                    error={actionData?.validationErrors?.featuredMapUrl}
                  />
                </div>
                <div>
                  <TextField
                    label="Map description"
                    id="featuredMapDescription"
                    placeholder="Overview of our codebase"
                  />
                </div>
              </div>
              <div className="w-1/3 relative">
                <img
                  src={mapThumbnailSrc}
                  width="362"
                  height="211"
                  alt=""
                  className="absolute w-full h-full object-cover opacity-50 rounded-lg"
                />
                <div className="absolute inset-0 z-10 flex items-center justify-center">
                  <ExternalLink
                    href="https://app.codesee.io/maps"
                    className="bg-light-interactive-fill px-4 py-2 rounded-lg"
                  >
                    Create a Map
                  </ExternalLink>
                </div>
              </div>
            </div>
            <div className="mt-8">
              <h2 className="font-bold text-lg mb-4">Review Maps</h2>
              <p className="mb-4">
                Show off some of the most impactful{" "}
                <ExternalLink href="https://www.codesee.io/code-reviews">
                  Review Maps
                </ExternalLink>{" "}
                in your repository. For example, here's{" "}
                <ExternalLink href="https://app.codesee.io/maps/review/github/Codesee-io/opensourcehub/pr/110">
                  an important Open Source Hub PR
                </ExternalLink>
                .
              </p>
              <RepeatableTextFields
                label="Review Maps"
                name="reviewMapUrls"
                maxFields={5}
                placeholder="https://app.codesee.io/maps/review/github/Codesee-io/opensourcehub/pr/110"
                type="url"
              />
            </div>
          </div>

          <div className="md:flex gap-6 bg-white border border-light-border p-4 rounded-lg mb-8">
            <div className="mb-6 md:mb-0 flex-auto md:w-2/3">
              <h2 className="font-bold text-lg mb-4">Project tags</h2>
              <div className="space-y-4">
                <div>
                  <label className="input-label">
                    Tech focus <RequiredMarker />
                  </label>
                  <input
                    type="hidden"
                    name="languages"
                    value={tags.languages.map((t) => t.label).join(",")}
                  />
                  <ReactSelect
                    classNamePrefix="custom-react-select"
                    className="mt-1"
                    placeholder="What technologies does your project cover?"
                    options={TECH_INTERESTS}
                    isMulti
                    onChange={updateTags("languages")}
                  />
                  <FieldError error={actionData?.validationErrors?.languages} />
                </div>
                <div>
                  <label className="input-label">
                    Contributor roles <RequiredMarker />
                  </label>
                  <input
                    type="hidden"
                    name="currentlySeeking"
                    value={tags.currentlySeeking.map((t) => t.label).join(",")}
                  />
                  <ReactSelect
                    classNamePrefix="custom-react-select"
                    className="mt-1"
                    placeholder="What kind of contributors are you looking for?"
                    options={ROLE_INTERESTS}
                    isMulti
                    onChange={updateTags("currentlySeeking")}
                  />
                  <FieldError
                    error={actionData?.validationErrors?.currentlySeeking}
                  />
                </div>
                <div>
                  <label className="input-label">
                    Subjects <RequiredMarker />
                  </label>
                  <input
                    type="hidden"
                    name="tags"
                    value={tags.tags.map((t) => t.label).join(",")}
                  />
                  <ReactSelect
                    classNamePrefix="custom-react-select"
                    className="mt-1"
                    placeholder="What is your project about?"
                    options={SUBJECT_INTERESTS}
                    isMulti
                    onChange={updateTags("tags")}
                  />
                  <FieldError error={actionData?.validationErrors?.tags} />
                </div>
              </div>
            </div>
            <div className="flex-auto md:w-1/3">
              <h2 className="font-bold text-lg mb-4">Contribution overview</h2>
              <div className="space-y-4">
                <div>
                  <TextField
                    id="automatedDevEnvironment"
                    label="Automated dev environment"
                    placeholder="gitpod.io"
                  />
                </div>
                <div>
                  <TextField
                    id="mainLocation"
                    label="Maintainer location"
                    placeholder="Africa"
                  />
                </div>
                <div>
                  <TextField
                    id="idealEffort"
                    label="Ideal contributor effort"
                    placeholder="1 PR per month"
                  />
                </div>
                <div className="pb-4">
                  <label className="text-sm flex gap-2 text-light-type-medium font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      name="isMentorshipAvailable"
                      className="cursor-pointer"
                    />
                    Mentorship is available
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-light-border p-4 rounded-lg mb-20">
            <h2 className="font-bold text-lg mb-4">Content</h2>
            <div className="mb-4">
              <TextArea
                required
                id="overview"
                label="Overview"
                style={{ minHeight: 200 }}
                placeholder="What is your project about? What does it do?"
              />
              <FieldError error={actionData?.validationErrors?.content} />
            </div>
            <div>
              <TextArea
                required
                id="contributing"
                label="Contributing"
                style={{ minHeight: 200 }}
                placeholder="How can potential contributors onboard efficiently?"
              />
              <FieldError error={actionData?.validationErrors?.contributing} />
            </div>
          </div>

          <div className="sticky bottom-4 z-20 bg-white border border-light-border p-4 rounded-lg flex gap-4 items-center shadow-lg">
            <Button
              type="button"
              onClick={() => setConfirmation(true)}
              variant="brand"
            >
              Submit
            </Button>
            <Button type="button" onClick={displayPreview}>
              Preview
            </Button>
            <span className="text-light-type-medium text-sm">
              ← Preview your project before submitting it 👀
            </span>
          </div>
        </Form>
      </main>
    </div>
  );
};

export default ListProject;
